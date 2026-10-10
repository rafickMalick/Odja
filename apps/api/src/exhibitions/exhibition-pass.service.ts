import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminPassView,
  ExhibitionPassView,
  ExhibitionStats,
  PassFormat,
  TicketCheckout,
} from '@oja/contracts';
import type { Exhibition, ExhibitionPass, Prisma } from '@oja/db';
import type { PaymentProvider, ProviderPaymentStatus, WebhookEvent } from '@oja/domain';
import { Prisma as PrismaRuntime } from '@oja/db';

import { NotificationService } from '../notifications/notification.service';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.factory';
import { PaymentService, type ExternalPaymentHandler } from '../payments/payment.service';
import { SimulatedPaymentProvider } from '../payments/simulated.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ExhibitionService, type PassChecker } from './exhibition.service';

type PassWithExhibition = ExhibitionPass & {
  exhibition: Pick<Exhibition, 'slug' | 'title' | 'startsAt' | 'endsAt'>;
};

/**
 * Billetterie des expositions (cahier des évolutions, § 8).
 *
 * Trois droits d'accès : l'inscription gratuite, le billet payé, l'invitation
 * par code. Le paiement d'un billet passe par le même fournisseur que les
 * commandes, derrière la même interface. Un billet n'est confirmé que sur la
 * parole du fournisseur — vérification serveur à serveur, montant compris :
 * jamais sur celle du navigateur.
 */
@Injectable()
export class ExhibitionPassService implements PassChecker, ExternalPaymentHandler, OnModuleInit {
  private readonly logger = new Logger(ExhibitionPassService.name);
  private readonly isProduction: boolean;
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exhibitions: ExhibitionService,
    private readonly notifications: NotificationService,
    private readonly simulated: SimulatedPaymentProvider,
    private readonly payments: PaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.webOrigin = config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  /**
   * La page publique interroge la billetterie pour ouvrir la galerie, et le
   * webhook de l'agrégateur lui transmet les notifications de billets.
   */
  onModuleInit(): void {
    this.exhibitions.usePassChecker(this);
    this.payments.useExternalPayments(this);
  }

  /**
   * Notification de l'agrégateur portant sur un billet. KKiaPay renvoie notre
   * identifiant (`partnerId`) : c'est lui qui relie la transaction au billet.
   * Le statut annoncé a déjà été relu auprès du fournisseur par le webhook.
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<boolean> {
    const pass = event.paymentId
      ? await this.prisma.exhibitionPass.findUnique({ where: { id: event.paymentId }, include: PASS_INCLUDE })
      : await this.prisma.exhibitionPass.findFirst({ where: { providerRef: event.reference }, include: PASS_INCLUDE });
    if (!pass) return false;

    /* Notification rejouée, ou billet déjà confirmé par le retour du widget :
       rien à refaire, mais c'est bien un billet. */
    if (pass.status !== 'PENDING_PAYMENT') return true;

    const known = await this.learnProviderRef(pass, event.reference);
    try {
      await this.apply(known, event.status);
    } catch (error) {
      /* Un montant ou un billet qui ne correspond pas est déjà signalé à
         l'équipe : on répond quand même, pour ne pas faire réessayer
         l'agrégateur sur un cas qui ne se résoudra pas seul. */
      this.logger.warn(`Billet ${pass.reference} : ${(error as Error).message}`);
    }
    return true;
  }

  async hasConfirmedPass(exhibitionId: string, userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    const pass = await this.prisma.exhibitionPass.findFirst({
      where: { exhibitionId, userId, status: 'CONFIRMED' },
      select: { id: true },
    });
    return pass !== null;
  }

  // ═══════════════════════════════ Visiteur

  async mine(userId: string): Promise<ExhibitionPassView[]> {
    const passes = await this.prisma.exhibitionPass.findMany({
      where: { userId },
      include: { exhibition: { select: { slug: true, title: true, startsAt: true, endsAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return passes.map(toView);
  }

  /** Inscription gratuite (§ 8.1) : immédiate, et confirmée par avis. */
  async register(slug: string, userId: string, format: PassFormat): Promise<ExhibitionPassView> {
    const exhibition = await this.exhibitions.requirePublic(slug);
    if (exhibition.accessMode !== 'FREE') {
      throw new BadRequestException(
        exhibition.accessMode === 'PAID'
          ? 'Cette exposition est payante : prenez un billet.'
          : 'Cette exposition est réservée : saisissez le code reçu de l’organisateur.',
      );
    }
    this.assertFormat(exhibition, format);

    const pass = await this.upsertConfirmed(exhibition, userId, format, 'REGISTRATION');
    await this.notifications.notice('visitor_notice', userId, {
      title: 'Inscription confirmée',
      body: `Vous êtes inscrit à « ${exhibition.title} ». Référence : ${pass.reference}.`,
      href: `/expositions/${exhibition.slug}`,
    });
    return toView(pass);
  }

  /** Invitation : le code de l'organisateur ouvre une exposition réservée. */
  async redeemCode(
    slug: string,
    userId: string,
    code: string,
    format: PassFormat,
  ): Promise<ExhibitionPassView> {
    const exhibition = await this.exhibitions.requirePublic(slug);
    if (exhibition.accessMode !== 'RESTRICTED') {
      throw new BadRequestException('Cette exposition ne demande pas de code.');
    }
    this.assertFormat(exhibition, format);
    if (!(await this.exhibitions.checkAccessCode(exhibition.id, code))) {
      throw new BadRequestException('Code incorrect.');
    }

    const pass = await this.upsertConfirmed(exhibition, userId, format, 'INVITATION');
    await this.notifications.notice('visitor_notice', userId, {
      title: 'Accès confirmé',
      body: `Votre accès à « ${exhibition.title} » est ouvert. Référence : ${pass.reference}.`,
      href: `/expositions/${exhibition.slug}`,
    });
    return toView(pass);
  }

  /**
   * Billet payant (§ 8.2) : le prix est affiché avant le paiement, et le
   * billet reste en attente tant que le fournisseur n'a pas confirmé.
   */
  async buyTicket(slug: string, userId: string, format: PassFormat): Promise<TicketCheckout> {
    const exhibition = await this.exhibitions.requirePublic(slug);
    if (exhibition.accessMode !== 'PAID' || exhibition.ticketPriceXof <= 0) {
      throw new BadRequestException('Cette exposition ne vend pas de billet.');
    }
    this.assertFormat(exhibition, format);

    const existing = await this.prisma.exhibitionPass.findUnique({
      where: { exhibitionId_userId_format: { exhibitionId: exhibition.id, userId, format } },
      include: PASS_INCLUDE,
    });
    if (existing?.status === 'CONFIRMED') {
      throw new ConflictException('Vous avez déjà un billet pour cette exposition.');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    const pass =
      existing ??
      (await this.prisma.$transaction(async (tx) =>
        tx.exhibitionPass.create({
          data: {
            reference: await nextReference(tx),
            exhibitionId: exhibition.id,
            userId,
            kind: 'TICKET',
            format,
            status: 'PENDING_PAYMENT',
            amountXof: exhibition.ticketPriceXof,
          },
          include: PASS_INCLUDE,
        }),
      ));

    /* Le montant suit le prix affiché aujourd'hui : un billet resté en
       attente ne garde pas un ancien tarif. */
    const amountXof = exhibition.ticketPriceXof;
    const initiated = await this.provider.initiate({
      paymentId: pass.id,
      orderReference: pass.reference,
      amountXof,
      channel: 'MOBILE_MONEY',
      customer: {
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        phone: user.phone,
      },
      callbackUrl: `${this.webOrigin}/expositions/${exhibition.slug}?billet=${pass.reference}`,
    });

    const updated = await this.prisma.exhibitionPass.update({
      where: { id: pass.id },
      data: {
        amountXof,
        status: 'PENDING_PAYMENT',
        provider: this.provider.name,
        providerRef: initiated.reference,
      },
      include: PASS_INCLUDE,
    });

    return {
      pass: toView(updated),
      checkout: {
        mode: initiated.checkout.mode,
        amountXof: initiated.checkout.amountXof,
        reference: initiated.reference,
        ...(initiated.checkout.publicKey !== undefined ? { publicKey: initiated.checkout.publicKey } : {}),
        ...(initiated.checkout.redirectUrl !== undefined
          ? { redirectUrl: initiated.checkout.redirectUrl }
          : {}),
        ...(initiated.checkout.sandbox !== undefined ? { sandbox: initiated.checkout.sandbox } : {}),
      },
      customer: {
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        phone: user.phone,
      },
    };
  }

  /**
   * Vérifie un billet auprès du fournisseur et le confirme s'il est payé.
   *
   * Appelée au retour du paiement. Idempotente : un billet déjà confirmé le
   * reste, un billet impayé reste en attente.
   */
  async verify(reference: string, userId: string, knownProviderRef?: string): Promise<ExhibitionPassView> {
    const found = await this.prisma.exhibitionPass.findFirst({
      where: { reference, userId },
      include: PASS_INCLUDE,
    });
    if (!found) throw new NotFoundException();
    if (found.status !== 'PENDING_PAYMENT') return toView(found);

    /* Le widget KKiaPay apprend au navigateur l'identifiant de transaction ;
       le serveur ne le connaît pas autrement avant le webhook. */
    const pass = knownProviderRef ? await this.learnProviderRef(found, knownProviderRef) : found;
    if (!pass.providerRef) return toView(pass);

    return this.apply(pass, await this.provider.verify(pass.providerRef));
  }

  /**
   * Retient la référence de transaction du fournisseur. Une référence déjà
   * attribuée à un autre billet est ignorée : présenter la transaction d'un
   * autre ne doit rien confirmer.
   */
  private async learnProviderRef(pass: PassWithExhibition, providerRef: string): Promise<PassWithExhibition> {
    if (pass.providerRef === providerRef) return pass;
    try {
      return await this.prisma.exhibitionPass.update({
        where: { id: pass.id },
        data: { providerRef },
        include: PASS_INCLUDE,
      });
    } catch (error) {
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`Référence ${providerRef} déjà attribuée — ignorée pour le billet ${pass.reference}`);
        return pass;
      }
      throw error;
    }
  }

  /** Paiement simulé, refusé en production — comme pour les commandes. */
  async simulatePayment(reference: string, userId: string): Promise<ExhibitionPassView> {
    if (this.isProduction) {
      throw new BadRequestException('La simulation de paiement est refusée en production.');
    }
    const pass = await this.prisma.exhibitionPass.findFirst({
      where: { reference, userId, status: 'PENDING_PAYMENT' },
      include: PASS_INCLUDE,
    });
    if (!pass?.providerRef) throw new NotFoundException('Aucun billet en attente de paiement.');

    return this.apply(pass, this.simulated.markPaid(pass.providerRef, pass.amountXof));
  }

  // ═══════════════════════════════ Administration

  async listForExhibition(exhibitionId: string): Promise<AdminPassView[]> {
    const passes = await this.prisma.exhibitionPass.findMany({
      where: { exhibitionId },
      include: { ...PASS_INCLUDE, user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return passes.map((pass) => ({
      ...toView(pass),
      holderName: `${pass.user.firstName} ${pass.user.lastName}`.trim(),
      holderEmail: pass.user.email,
    }));
  }

  /** Fréquentation et ventes d'une exposition (§ 11.4, 11.5). */
  async stats(exhibitionId: string): Promise<ExhibitionStats> {
    const exhibition = await this.prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      select: { viewCount: true, works: { select: { productId: true } }, publishAt: true, createdAt: true },
    });
    if (!exhibition) throw new NotFoundException();

    const [byKind, ticketRevenue] = await Promise.all([
      this.prisma.exhibitionPass.groupBy({
        by: ['kind', 'status'],
        where: { exhibitionId },
        _count: { _all: true },
      }),
      this.prisma.exhibitionPass.aggregate({
        where: { exhibitionId, kind: 'TICKET', status: 'CONFIRMED' },
        _sum: { amountXof: true },
      }),
    ]);
    const count = (kind: string, status: string) =>
      byKind.find((row) => row.kind === kind && row.status === status)?._count._all ?? 0;

    /* Les ventes d'œuvres sont les lignes de commandes payées portant sur
       une pièce exposée, depuis l'ouverture du dossier. */
    const productIds = exhibition.works.flatMap((work) => (work.productId ? [work.productId] : []));
    const lines = productIds.length
      ? await this.prisma.orderLine.findMany({
          where: {
            productId: { in: productIds },
            subOrder: {
              order: {
                status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'] },
                createdAt: { gte: exhibition.publishAt ?? exhibition.createdAt },
              },
            },
          },
          select: { quantity: true, lineTotalXof: true, subOrder: { select: { orderId: true } } },
        })
      : [];

    return {
      views: exhibition.viewCount,
      registrations: count('REGISTRATION', 'CONFIRMED'),
      invitations: count('INVITATION', 'CONFIRMED'),
      ticketsConfirmed: count('TICKET', 'CONFIRMED'),
      ticketsPending: count('TICKET', 'PENDING_PAYMENT'),
      ticketRevenueXof: ticketRevenue._sum.amountXof ?? 0,
      ordersCount: new Set(lines.map((line) => line.subOrder.orderId)).size,
      worksSold: lines.reduce((total, line) => total + line.quantity, 0),
      salesXof: lines.reduce((total, line) => total + line.lineTotalXof, 0),
    };
  }

  // ═══════════════════════════════ Utilitaires

  /** Contrôles du § 7.5 des commandes, appliqués aux billets : statut et montant. */
  private async apply(pass: PassWithExhibition, status: ProviderPaymentStatus): Promise<ExhibitionPassView> {
    if (status.status === 'pending') return toView(pass);

    if (status.status === 'failed') {
      this.logger.warn(`Billet ${pass.reference} : paiement refusé (${status.message})`);
      return toView(pass);
    }

    /* KKiaPay garde notre identifiant sur la transaction (`partnerId`) : une
       transaction ouverte pour autre chose — une commande, un autre billet du
       même prix — ne confirme pas ce billet. */
    if (status.paymentId && status.paymentId !== pass.id) {
      await this.notifications.adminNotice({
        title: 'Transaction présentée pour un autre billet',
        body: `${pass.reference} : la transaction appartient à un autre paiement.`,
        href: '/admin/expositions',
      });
      throw new BadRequestException('Cette transaction ne correspond pas à ce billet.');
    }

    if (status.amountXof < pass.amountXof) {
      /* Un paiement partiel n'ouvre pas l'accès : on le signale à l'équipe
         plutôt que de le confirmer en silence. */
      await this.notifications.adminNotice({
        title: 'Billet payé partiellement',
        body: `${pass.reference} : ${status.amountXof} F reçus pour ${pass.amountXof} F attendus.`,
        href: '/admin/expositions',
      });
      throw new BadRequestException('Le montant reçu ne correspond pas au prix du billet.');
    }

    const confirmed = await this.prisma.exhibitionPass.update({
      where: { id: pass.id },
      data: { status: 'CONFIRMED', paidAt: status.paidAt },
      include: PASS_INCLUDE,
    });

    await this.notifications.notice('visitor_notice', pass.userId, {
      title: 'Billet confirmé',
      body: `Votre billet pour « ${pass.exhibition.title} » est confirmé. Référence : ${pass.reference}.`,
      href: `/expositions/${pass.exhibition.slug}`,
    });
    return toView(confirmed);
  }

  private async upsertConfirmed(
    exhibition: Exhibition,
    userId: string,
    format: PassFormat,
    kind: 'REGISTRATION' | 'INVITATION',
  ): Promise<PassWithExhibition> {
    const existing = await this.prisma.exhibitionPass.findUnique({
      where: { exhibitionId_userId_format: { exhibitionId: exhibition.id, userId, format } },
      include: PASS_INCLUDE,
    });
    if (existing) {
      if (existing.status === 'CONFIRMED') return existing;
      return this.prisma.exhibitionPass.update({
        where: { id: existing.id },
        data: { status: 'CONFIRMED', kind },
        include: PASS_INCLUDE,
      });
    }
    return this.prisma.$transaction(async (tx) =>
      tx.exhibitionPass.create({
        data: {
          reference: await nextReference(tx),
          exhibitionId: exhibition.id,
          userId,
          kind,
          format,
          status: 'CONFIRMED',
        },
        include: PASS_INCLUDE,
      }),
    );
  }

  /** Une exposition en ligne n'a pas de billet sur place, et inversement. */
  private assertFormat(exhibition: Exhibition, format: PassFormat): void {
    if (exhibition.format === 'ONLINE' && format === 'ONSITE') {
      throw new BadRequestException('Cette exposition se visite uniquement en ligne.');
    }
    if (exhibition.format === 'PHYSICAL' && format === 'ONLINE') {
      throw new BadRequestException('Cette exposition se visite uniquement sur place.');
    }
  }
}

const PASS_INCLUDE = {
  exhibition: { select: { slug: true, title: true, startsAt: true, endsAt: true } },
} satisfies Prisma.ExhibitionPassInclude;

function toView(pass: PassWithExhibition): ExhibitionPassView {
  return {
    reference: pass.reference,
    exhibition: {
      slug: pass.exhibition.slug,
      title: pass.exhibition.title,
      startsAt: pass.exhibition.startsAt.toISOString(),
      endsAt: pass.exhibition.endsAt.toISOString(),
    },
    kind: pass.kind,
    format: pass.format,
    status: pass.status,
    amountXof: pass.amountXof,
    paidAt: pass.paidAt?.toISOString() ?? null,
    createdAt: pass.createdAt.toISOString(),
  };
}

/** Numérotation sans trou, comme les commandes : BIL-2026-000001. */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await tx.referenceCounter.upsert({
    where: { scope_year: { scope: 'exhibition_pass', year } },
    update: { value: { increment: 1 } },
    create: { scope: 'exhibition_pass', year, value: 1 },
  });
  return `BIL-${year}-${String(counter.value).padStart(6, '0')}`;
}
