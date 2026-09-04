import { Injectable, Logger } from '@nestjs/common';
import type { LedgerAccountType, Prisma } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Grand livre en partie double.
 *
 * Il se construit maintenant, sans attendre l'agrégateur de paiement : un
 * encaissement simulé écrit exactement les mêmes lignes qu'un encaissement
 * réel. C'est lui qui rend le reste juste.
 *
 * Pourquoi la partie double plutôt qu'une colonne `solde` : Ojà détient
 * l'argent d'autrui. Une colonne tient jusqu'au premier remboursement partiel
 * sur une commande à trois ateliers, et ensuite plus personne ne sait ni
 * pourquoi ni depuis quand un solde vaut ce qu'il vaut. Ici chaque franc a une
 * origine traçable, rien n'est modifié après coup, et une erreur se détecte
 * mécaniquement — la base **refuse** une transaction déséquilibrée.
 */

export interface LedgerLeg {
  type: LedgerAccountType;
  /** userId pour les comptes nominatifs, absent pour les comptes de plateforme. */
  ownerId?: string | null;
  /** Signé : positif au débit, négatif au crédit. */
  amountXof: number;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Écrit une transaction comptable.
   *
   * La somme des montants doit valoir zéro. On le vérifie ici pour donner un
   * message utile, mais **la base le vérifie aussi** par une contrainte
   * différée : le contrôle applicatif est un confort, la garantie est en base.
   */
  async record(
    tx: Prisma.TransactionClient,
    entry: {
      kind: string;
      refType: string;
      refId: string;
      memo?: string;
      legs: LedgerLeg[];
    },
  ): Promise<string> {
    const total = entry.legs.reduce((sum, leg) => sum + leg.amountXof, 0);
    if (total !== 0) {
      throw new Error(
        `transaction « ${entry.kind} » déséquilibrée : ${entry.legs.length} lignes, ` +
          `somme = ${total} XOF au lieu de 0`,
      );
    }

    // Les lignes à zéro n'apportent rien et encombrent la lecture du livre.
    const legs = entry.legs.filter((leg) => leg.amountXof !== 0);
    if (legs.length === 0) {
      throw new Error(`transaction « ${entry.kind} » sans aucun montant`);
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        kind: entry.kind,
        refType: entry.refType,
        refId: entry.refId,
        ...(entry.memo ? { memo: entry.memo } : {}),
      },
    });

    for (const leg of legs) {
      const accountId = await this.accountIdFor(tx, leg.type, leg.ownerId ?? null);
      await tx.ledgerEntry.create({
        data: { transactionId: transaction.id, accountId, amountXof: leg.amountXof },
      });
    }

    return transaction.id;
  }

  /**
   * Écritures d'un encaissement.
   *
   * Le modèle du cahier client : la commission s'ajoute au prix du créateur.
   * L'argent entre en caisse, et se répartit en dettes envers les créateurs,
   * en provision de livraison, en revenu Ojà et en TVA due.
   *
   * ```
   *   PLATFORM_CASH        +108 000   ce que le client a payé
   *   MAKER_PAYABLE        -100 000   dû au créateur, en entier
   *   COURIER_PAYABLE        -3 000   provision de livraison
   *   PLATFORM_REVENUE       -5 000   commission Ojà
   *   ─────────────────────────────
   *   somme                       0
   * ```
   */
  async recordOrderPaid(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      reference: string;
      totalXof: number;
      commissionTotalXof: number;
      deliveryTotalXof: number;
      vatXof: number;
      /** Remise d'un code promo, absorbée par la commission Ojà. */
      discountXof?: number;
      subOrders: { makerId: string; itemsMakerSubtotalXof: number }[];
    },
  ): Promise<void> {
    /* Le compte nominatif est celui de l'UTILISATEUR, pas du profil créateur :
       c'est à une personne qu'on doit de l'argent, et c'est son compte qui
       recevra le versement. */
    const makerUserIds = await this.makerUserIds(
      tx,
      order.subOrders.map((subOrder) => subOrder.makerId),
    );

    /* Un code promo diminue ce que le client paie ; la différence est
       entièrement à la charge d'Ojà. On l'impute donc sur son revenu de
       commission — le back-office a déjà borné la remise à cette commission,
       si bien que le créateur et le livreur restent payés en entier. La caisse
       encaisse le total remisé, la somme des lignes reste nulle. */
    const discountXof = order.discountXof ?? 0;

    const legs: LedgerLeg[] = [
      { type: 'PLATFORM_CASH', amountXof: order.totalXof },
      ...order.subOrders.map((subOrder) => ({
        type: 'MAKER_PAYABLE' as const,
        ownerId: makerUserIds.get(subOrder.makerId) ?? subOrder.makerId,
        amountXof: -subOrder.itemsMakerSubtotalXof,
      })),
      /* La livraison est provisionnée en bloc. Le partage entre la course du
         livreur et la marge d'Ojà attend l'arbitrage du § 9-F de
         SPEC-ALIGNEMENT : tant qu'il n'est pas tranché, provisionner la
         totalité est le choix prudent — on ne compte pas comme revenu ce
         qu'on devra peut-être reverser. */
      { type: 'COURIER_PAYABLE', amountXof: -order.deliveryTotalXof },
      { type: 'PLATFORM_REVENUE', amountXof: -(order.commissionTotalXof - discountXof) },
      { type: 'VAT_PAYABLE', amountXof: -order.vatXof },
    ];

    await this.record(tx, {
      kind: 'order_paid',
      refType: 'order',
      refId: order.id,
      memo: `Encaissement ${order.reference}`,
      legs,
    });
  }

  /**
   * Frais retenus par l'agrégateur, imputés à Ojà et non au créateur.
   *
   * Écriture distincte de l'encaissement : ce sont deux faits différents, et
   * les mélanger rendrait impossible de mesurer ce que le paiement coûte
   * réellement.
   */
  async recordPspFee(
    tx: Prisma.TransactionClient,
    payment: { id: string; feeXof: number },
  ): Promise<void> {
    if (payment.feeXof <= 0) return;

    await this.record(tx, {
      kind: 'psp_fee',
      refType: 'payment',
      refId: payment.id,
      memo: 'Frais agrégateur',
      legs: [
        { type: 'PSP_FEE', amountXof: payment.feeXof },
        { type: 'PLATFORM_CASH', amountXof: -payment.feeXof },
      ],
    });
  }

  /**
   * Annulation de la dette envers un créateur dont la sous-commande est
   * refusée ou annulée. Le montant retourne au client.
   */
  async recordSubOrderCancelled(
    tx: Prisma.TransactionClient,
    subOrder: {
      id: string;
      reference: string;
      makerId: string;
      itemsMakerSubtotalXof: number;
      deliveryFeeXof: number;
    },
    customerId: string,
  ): Promise<void> {
    const makerUserIds = await this.makerUserIds(tx, [subOrder.makerId]);

    await this.record(tx, {
      kind: 'sub_order_cancelled',
      refType: 'sub_order',
      refId: subOrder.id,
      memo: `Annulation ${subOrder.reference}`,
      legs: [
        // La dette envers le créateur s'éteint…
        {
          type: 'MAKER_PAYABLE',
          ownerId: makerUserIds.get(subOrder.makerId) ?? subOrder.makerId,
          amountXof: subOrder.itemsMakerSubtotalXof,
        },
        // …ainsi que la provision de livraison qui n'aura pas lieu…
        { type: 'COURIER_PAYABLE', amountXof: subOrder.deliveryFeeXof },
        // …et le tout devient dû au client.
        {
          type: 'CUSTOMER_REFUNDABLE',
          ownerId: customerId,
          amountXof: -(subOrder.itemsMakerSubtotalXof + subOrder.deliveryFeeXof),
        },
      ],
    });
  }

  /**
   * Remboursement décidé à l'issue d'une réclamation.
   *
   * Règle du cahier client : **100 % du prix produit**, jamais partiel. Les
   * frais de livraison et la commission restent acquis à Ojà — la course a eu
   * lieu, le service aussi.
   *
   * Reste à dire **qui supporte la perte**. Deux cas, et c'est
   * l'administration qui tranche :
   *
   *   · le créateur a livré une pièce cassée ou non conforme → sa dette
   *     s'éteint, il ne sera pas payé ;
   *   · le litige ne lui est pas imputable (casse en transit, erreur d'Ojà)
   *     → il est payé quand même, et Ojà absorbe le remboursement.
   *
   * Ce choix n'a pas de bonne réponse universelle : il dépend de la règle de
   * prise en charge de la casse, encore à écrire (SPEC-ALIGNEMENT § 9-E).
   */
  async recordDisputeRefund(
    tx: Prisma.TransactionClient,
    dispute: {
      id: string;
      reference: string;
      makerId: string;
      customerId: string;
      productRefundXof: number;
      deliveryRefundXof: number;
      chargeToMaker: boolean;
    },
  ): Promise<void> {
    const total = dispute.productRefundXof + dispute.deliveryRefundXof;
    if (total <= 0) return;

    const makerUserIds = await this.makerUserIds(tx, [dispute.makerId]);
    const makerUserId = makerUserIds.get(dispute.makerId) ?? dispute.makerId;

    const legs: LedgerLeg[] = [
      // Le client récupère son argent.
      { type: 'CUSTOMER_REFUNDABLE', ownerId: dispute.customerId, amountXof: -total },
    ];

    if (dispute.chargeToMaker) {
      // La dette envers le créateur s'éteint à hauteur du prix produit.
      legs.push({
        type: 'MAKER_PAYABLE',
        ownerId: makerUserId,
        amountXof: dispute.productRefundXof,
      });
    } else {
      // Le créateur garde son dû : c'est le revenu d'Ojà qui absorbe.
      legs.push({ type: 'PLATFORM_REVENUE', amountXof: dispute.productRefundXof });
    }

    if (dispute.deliveryRefundXof > 0) {
      /* Geste commercial sur la livraison : il sort de la provision de course,
         jamais de la poche du créateur — il n'y est pour rien. */
      legs.push({ type: 'COURIER_PAYABLE', amountXof: dispute.deliveryRefundXof });
    }

    await this.record(tx, {
      kind: 'dispute_refund',
      refType: 'dispute',
      refId: dispute.id,
      memo: `Remboursement ${dispute.reference}`,
      legs,
    });
  }

  /** Solde d'un compte, calculé depuis les écritures — jamais dénormalisé. */
  async balanceOf(type: LedgerAccountType, ownerId: string | null = null): Promise<number> {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { type, ownerId } });
    if (!account) return 0;

    const aggregate = await this.prisma.ledgerEntry.aggregate({
      where: { accountId: account.id },
      _sum: { amountXof: true },
    });
    return aggregate._sum.amountXof ?? 0;
  }

  /**
   * Vérifie les invariants du § 8.2 du cahier.
   *
   * À faire tourner chaque nuit : un écart n'est pas un ticket, c'est une
   * alerte de niveau critique — il signifie que de l'argent a été compté deux
   * fois, ou pas du tout.
   */
  async checkInvariants(): Promise<{ ok: boolean; problems: string[] }> {
    const problems: string[] = [];

    // I1 — chaque transaction est équilibrée.
    const unbalanced = await this.prisma.$queryRaw<{ transactionId: string; total: bigint }[]>`
      SELECT "transactionId", SUM("amountXof")::bigint AS total
        FROM ledger_entries
       GROUP BY "transactionId"
      HAVING SUM("amountXof") <> 0
    `;
    for (const row of unbalanced) {
      problems.push(`transaction ${row.transactionId} déséquilibrée (${row.total} XOF)`);
    }

    // I2 — on ne doit jamais de l'argent négatif à un créateur.
    const negative = await this.prisma.$queryRaw<{ type: string; ownerId: string; total: bigint }[]>`
      SELECT a.type, a."ownerId", SUM(e."amountXof")::bigint AS total
        FROM ledger_accounts a
        JOIN ledger_entries e ON e."accountId" = a.id
       WHERE a.type IN ('MAKER_PAYABLE', 'COURIER_PAYABLE')
       GROUP BY a.type, a."ownerId"
      HAVING SUM(e."amountXof") > 0
    `;
    for (const row of negative) {
      problems.push(`${row.type} de ${row.ownerId} au débit (${row.total} XOF)`);
    }

    // I3 — la caisse égale la somme de ce qu'on doit et de ce qu'on a gagné.
    const [cash, rest] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COALESCE(SUM(e."amountXof"), 0)::bigint AS total
          FROM ledger_accounts a
          JOIN ledger_entries e ON e."accountId" = a.id
         WHERE a.type = 'PLATFORM_CASH'
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COALESCE(SUM(e."amountXof"), 0)::bigint AS total
          FROM ledger_accounts a
          JOIN ledger_entries e ON e."accountId" = a.id
         WHERE a.type <> 'PLATFORM_CASH'
      `,
    ]);

    const cashTotal = Number(cash[0]?.total ?? 0);
    const restTotal = Number(rest[0]?.total ?? 0);
    if (cashTotal + restTotal !== 0) {
      problems.push(
        `caisse et contreparties divergent : ${cashTotal} + ${restTotal} ≠ 0`,
      );
    }

    if (problems.length > 0) {
      this.logger.error(`Grand livre incohérent : ${problems.length} anomalie(s)`);
    }

    return { ok: problems.length === 0, problems };
  }

  private async makerUserIds(
    tx: Prisma.TransactionClient,
    makerIds: string[],
  ): Promise<Map<string, string>> {
    const makers = await tx.makerProfile.findMany({
      where: { id: { in: makerIds } },
      select: { id: true, userId: true },
    });
    return new Map(makers.map((maker) => [maker.id, maker.userId]));
  }

  /** Crée le compte à la volée : un bénéficiaire n'existe qu'au premier franc. */
  private async accountIdFor(
    tx: Prisma.TransactionClient,
    type: LedgerAccountType,
    ownerId: string | null,
  ): Promise<string> {
    const existing = await tx.ledgerAccount.findFirst({ where: { type, ownerId } });
    if (existing) return existing.id;

    const created = await tx.ledgerAccount.create({ data: { type, ownerId } });
    return created.id;
  }
}
