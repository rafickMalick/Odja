import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LEGAL, type InvoiceView } from '@oja/contracts';
import type { Prisma } from '@oja/db';
import PDFDocument from 'pdfkit';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Facture numérotée, archivée, immuable (cahier L2-20).
 *
 * Une par commande, émise à l'encaissement. Le PDF est composé sur le serveur
 * puis déposé dans le stockage privé : on ne renvoie jamais le fichier
 * directement, seulement une URL signée de courte durée. La numérotation passe
 * par le compteur `ReferenceCounter` — sans trou, comme les commandes.
 *
 * Rien ne réécrit une facture : `generateForOrder` est idempotent et il
 * n'existe aucune route de modification.
 *
 * **Émise à l'encaissement** : l'ordonnanceur émet, toutes les cinq minutes,
 * la facture de chaque commande payée qui n'en a pas encore (`issuePending`),
 * dans l'ordre des paiements. Elle porte la date du paiement, quel que soit
 * le moment où le PDF est composé. Le téléchargement l'émet aussi, s'il passe
 * avant l'ordonnanceur.
 *
 * **Sans trou** : deux émissions simultanées (l'ordonnanceur et un clic) ne
 * doivent pas consommer deux numéros. Toute émission prend un verrou
 * PostgreSQL de transaction, et le compteur n'avance qu'une fois le PDF
 * déposé : un dépôt qui échoue n'use aucun numéro.
 */
/** Commandes sans facture : pas encore payées, ou annulées avant paiement. */
export const UNPAID = ['PENDING_PAYMENT', 'CANCELLED'] as const;

/** Verrou consultatif PostgreSQL de l'émission des factures (« FACT » en ASCII). */
const INVOICE_LOCK = 0x46414354;

/**
 * Mentions légales du vendeur, telles que renseignées dans `LEGAL`
 * (`@oja/contracts`). Une mention absente n'est pas imprimée : jamais
 * d'information inventée sur une pièce comptable.
 */
export function sellerMentions(): string[] {
  return [
    LEGAL.legalForm,
    LEGAL.address,
    LEGAL.rccm ? `RCCM : ${LEGAL.rccm}` : null,
    LEGAL.ifu ? `IFU : ${LEGAL.ifu}` : null,
    LEGAL.supportEmail ? `Contact : ${LEGAL.supportEmail}` : null,
  ].filter((mention): mention is string => Boolean(mention));
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Émet la facture d'une commande. Retourne l'existante si elle est déjà là :
   * appeler deux fois (capture du paiement, puis clic « télécharger ») ne
   * produit qu'un document.
   */
  async generateForOrder(orderId: string): Promise<{ number: string; issuedAt: Date; pdfKey: string }> {
    const existing = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (existing) {
      return { number: existing.number, issuedAt: existing.issuedAt, pdfKey: existing.pdfKey };
    }

    /* Une transaction tient le verrou le temps de composer et déposer le
       PDF — une à deux secondes. C'est l'exception à la règle « pas de
       transaction ouverte pendant un appel externe » : la numérotation sans
       trou l'exige, et rien d'autre n'attend ce verrou que l'émission des
       factures. */
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_LOCK})`;

        // Une émission concurrente a pu passer pendant l'attente du verrou.
        const issued = await tx.invoice.findUnique({ where: { orderId } });
        if (issued) {
          return { number: issued.number, issuedAt: issued.issuedAt, pdfKey: issued.pdfKey };
        }

        return this.issue(tx, orderId);
      },
      { timeout: 60_000, maxWait: 60_000 },
    );
  }

  /**
   * Émet les factures en attente : commandes payées sans facture, dans
   * l'ordre des paiements. Appelée par l'ordonnanceur ; une facture qui
   * échoue (stockage indisponible) est réessayée au passage suivant.
   */
  async issuePending(limit = 50): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: { invoice: null, status: { notIn: [...UNPAID] } },
      select: { id: true, reference: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let issued = 0;
    for (const order of orders) {
      try {
        await this.generateForOrder(order.id);
        issued++;
      } catch (error) {
        this.logger.error(
          `Facture non émise pour ${order.reference} : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return issued;
  }

  /** Composition, dépôt, puis numéro et enregistrement — verrou tenu. */
  private async issue(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{ number: string; issuedAt: Date; pdfKey: string }> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { email: true } },
        promoCode: { select: { code: true } },
        subOrders: {
          orderBy: { reference: 'asc' },
          include: { maker: { select: { shopName: true } }, lines: true },
        },
      },
    });
    if (!order) throw new NotFoundException();

    const city = await tx.city.findUnique({
      where: { id: order.shipCityId },
      include: { country: true },
    });
    const country = city?.country.name ?? '—';
    const vatBps = city?.country.vatBps ?? 0;

    // Date d'émission : celle de l'encaissement, pas celle du premier clic.
    const payment = await tx.payment.findFirst({
      where: { orderId, status: 'PAID' },
      orderBy: { paidAt: 'asc' },
      select: { paidAt: true },
    });
    const issuedAt = payment?.paidAt ?? new Date();

    /* Le numéro est lu, pas encore pris : sous le verrou, personne d'autre
       ne peut le prendre, et il n'avance qu'après un dépôt réussi. */
    const year = issuedAt.getFullYear();
    const counter = await tx.referenceCounter.findUnique({
      where: { scope_year: { scope: 'invoice', year } },
    });
    const value = (counter?.value ?? 0) + 1;
    const number = `FAC-${year}-${String(value).padStart(6, '0')}`;

    const pdf = await this.render(number, { ...order, country, vatBps, issuedAt });
    const pdfKey = await this.storage.putPrivateObject(
      `invoices/${year}/${number}.pdf`,
      pdf,
      'application/pdf',
    );

    await tx.referenceCounter.upsert({
      where: { scope_year: { scope: 'invoice', year } },
      update: { value },
      create: { scope: 'invoice', year, value },
    });
    const invoice = await tx.invoice.create({
      data: {
        number,
        orderId: order.id,
        issuedAt,
        pdfKey,
        totalXof: order.totalXof,
        vatXof: order.vatXof,
        discountXof: order.discountXof,
        country,
      },
    });

    this.logger.log(`Facture ${number} émise pour ${order.reference}`);
    return { number: invoice.number, issuedAt: invoice.issuedAt, pdfKey };
  }

  /**
   * URL de téléchargement pour le client (ou un administrateur). La propriété
   * est dans le WHERE : une commande d'autrui renvoie 404, jamais 403.
   */
  async urlForOrder(reference: string, userId: string, isAdmin: boolean): Promise<InvoiceView> {
    const order = await this.prisma.order.findFirst({
      where: { reference, ...(isAdmin ? {} : { customerId: userId }) },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException();

    const unpaid = (UNPAID as readonly string[]).includes(order.status);
    if (unpaid) {
      throw new NotFoundException('Aucune facture : cette commande n’est pas payée.');
    }

    const invoice = await this.generateForOrder(order.id);
    const url = await this.storage.createReadUrl(invoice.pdfKey);
    return { number: invoice.number, issuedAt: invoice.issuedAt.toISOString(), url };
  }

  // ═══════════════════════════════ Rendu

  private render(number: string, order: InvoiceRenderData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // ── En-tête : le vendeur, avec ses mentions légales quand elles existent ──
    doc.fontSize(20).text(LEGAL.companyName ?? LEGAL.brand, { continued: false });
    doc
      .fontSize(9)
      .fillColor('#666')
      .text('Ojà — place de marché du mobilier et de la décoration façonnés localement');
    for (const mention of sellerMentions()) doc.text(mention);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(14).text(`Facture ${number}`);
    doc
      .fontSize(10)
      .fillColor('#666')
      .text(`Émise le ${formatDate(order.issuedAt)}`)
      .text(`Commande ${order.reference} — passée le ${formatDate(order.createdAt)}`)
      .moveDown(1);

    // ── Client ──
    doc.fillColor('#000').fontSize(11).text('Facturé à');
    doc
      .fontSize(10)
      .fillColor('#333')
      .text(order.shipFullName)
      .text(order.shipLine1)
      .text(order.shipLandmark ?? '')
      .text(`${order.country}`)
      .moveDown(1);

    // ── Lignes, par atelier ──
    //
    // On facture le **prix affiché au client**, celui qu'il a vu et validé au
    // panier (part créateur + commission Ojà déjà réunies). Aucune ligne ne
    // décompose « 50 000 + 2 500 » : sur une facture, ce détail n'a pas sa
    // place, et le client ne l'a jamais payé séparément.
    for (const subOrder of order.subOrders) {
      doc
        .fillColor('#000')
        .fontSize(11)
        .text(`${subOrder.maker.shopName} — ${subOrder.reference}`);
      doc.fontSize(10).fillColor('#333');
      for (const line of subOrder.lines) {
        doc.text(
          `${line.productName} — ${line.quantity} × ${money(line.finalPriceXof)}`,
          { continued: true },
        );
        doc.text(money(line.lineTotalXof), { align: 'right' });
      }
      if (subOrder.deliveryFeeXof > 0) {
        doc
          .fillColor('#666')
          .text('Livraison', { continued: true })
          .text(money(subOrder.deliveryFeeXof), { align: 'right' })
          .fillColor('#333');
      }
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5).fillColor('#000');

    // ── Totaux ──
    const row = (label: string, value: string) =>
      doc
        .fontSize(10)
        .text(label, { continued: true })
        .text(value, { align: 'right' });
    row('Sous-total articles', money(order.itemsFinalTotalXof));
    row('Livraison', money(order.deliveryTotalXof));
    if (order.discountXof > 0) {
      row(
        `Remise${order.promoCode ? ` (${order.promoCode.code})` : ''}`,
        `- ${money(order.discountXof)}`,
      );
    }
    row(
      `TVA (${order.country}${order.vatBps > 0 ? ` — ${(order.vatBps / 100).toString().replace('.', ',')} %` : ' — non applicable'})`,
      money(order.vatXof),
    );
    doc
      .moveDown(0.3)
      .fontSize(12)
      .text('Total payé', { continued: true })
      .text(money(order.totalXof), { align: 'right' });

    // ── Mentions légales ──
    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#888')
      .text(
        'Les prix indiqués sont les prix affichés au client, commission Ojà comprise. ' +
          `TVA calculée selon le pays de livraison : ${order.country}. ` +
          (order.vatBps > 0
            ? `Taux appliqué : ${(order.vatBps / 100).toString().replace('.', ',')} %.`
            : "Aucune TVA n'est due à ce jour sur ce pays de livraison.") +
          ' Facture émise par Ojà en qualité d’intermédiaire de place de marché. ' +
          'Document conservé et non modifiable.',
        { align: 'left' },
      );

    doc.end();
    return done;
  }
}

interface InvoiceRenderData {
  reference: string;
  createdAt: Date;
  /** Date de l'encaissement : celle qui figure sur la facture. */
  issuedAt: Date;
  shipFullName: string;
  shipLine1: string;
  shipLandmark: string | null;
  itemsFinalTotalXof: number;
  deliveryTotalXof: number;
  discountXof: number;
  vatXof: number;
  totalXof: number;
  country: string;
  vatBps: number;
  promoCode: { code: string } | null;
  subOrders: {
    reference: string;
    deliveryFeeXof: number;
    maker: { shopName: string };
    lines: { productName: string; quantity: number; finalPriceXof: number; lineTotalXof: number }[];
  }[];
}

function money(amountXof: number): string {
  return `${amountXof.toLocaleString('fr-FR').replace(/ | /g, ' ')} F CFA`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}
