import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  DisputeMessageInput,
  DisputeReason,
  DisputeView,
  ResolveDisputeInput,
} from '@oja/contracts';
import { DISPUTE_REASON_LABELS } from '@oja/contracts';
import type { Prisma } from '@oja/db';

import { LedgerService } from '../ledger/ledger.service';
import { SmsService } from '../notifications/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Ouverte',
  UNDER_REVIEW: 'En cours d’examen',
  RESOLVED: 'Résolue',
  REJECTED: 'Rejetée',
};

const WITH_MESSAGES = {
  messages: { orderBy: { createdAt: 'asc' as const } },
  order: { select: { reference: true, customerId: true } },
};

/**
 * Réclamations.
 *
 * Le cahier client confie tout au Support : « Recevoir les plaintes, traiter
 * les litiges, répondre aux créateurs, répondre aux clients ». Les deux
 * parties parlent à Ojà, **jamais l'une à l'autre** — c'est la règle métier
 * qui fonde la place de marché.
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationService,
  ) {}

  // ═══════════════════════════════ Consultation

  /** Réclamations du client. */
  async listForCustomer(userId: string): Promise<DisputeView[]> {
    const disputes = await this.prisma.dispute.findMany({
      where: { order: { customerId: userId } },
      include: WITH_MESSAGES,
      orderBy: { createdAt: 'desc' },
    });
    return this.toViews(disputes, false);
  }

  /** Réclamations touchant les sous-commandes d'un créateur. */
  async listForMaker(userId: string): Promise<DisputeView[]> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    const subOrders = await this.prisma.subOrder.findMany({
      where: { makerId: maker.id },
      select: { id: true },
    });

    const disputes = await this.prisma.dispute.findMany({
      where: { subOrderId: { in: subOrders.map((subOrder) => subOrder.id) } },
      include: WITH_MESSAGES,
      orderBy: { createdAt: 'desc' },
    });
    return this.toViews(disputes, false);
  }

  async listForAdmin(onlyOpen = false): Promise<DisputeView[]> {
    const disputes = await this.prisma.dispute.findMany({
      where: onlyOpen ? { status: { in: ['OPEN', 'UNDER_REVIEW'] } } : {},
      include: WITH_MESSAGES,
      // Les plus urgentes d'abord : le délai de traitement est un engagement.
      orderBy: { slaDueAt: 'asc' },
      take: 200,
    });
    return this.toViews(disputes, true);
  }

  async byReference(reference: string, viewer: { id: string; role: string }): Promise<DisputeView> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { reference },
      include: { ...WITH_MESSAGES, subOrder: { select: { makerId: true } } },
    });
    if (!dispute) throw new NotFoundException();

    const isAdmin = viewer.role === 'ADMIN';
    if (!isAdmin && !(await this.isParty(dispute, viewer.id))) {
      // Un tiers ne doit pas apprendre qu'une réclamation existe.
      throw new NotFoundException();
    }

    const [view] = await this.toViews([dispute], isAdmin);
    return view!;
  }

  // ═══════════════════════════════ Échanges

  async addMessage(
    reference: string,
    author: { id: string; role: string },
    input: DisputeMessageInput,
  ): Promise<{ id: string }> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { reference },
      include: { subOrder: { select: { makerId: true } } },
    });
    if (!dispute) throw new NotFoundException();

    const isAdmin = author.role === 'ADMIN';
    if (!isAdmin && !(await this.isParty(dispute, author.id))) {
      throw new NotFoundException();
    }

    if (input.isInternal && !isAdmin) {
      /* Une note interne écrite par une partie serait lisible par
         l'administration seule, mais la partie croirait s'adresser à l'autre.
         Mieux vaut refuser franchement. */
      throw new ForbiddenException('Les notes internes sont réservées à l’équipe Ojà.');
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cette réclamation est close.');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.disputeMessage.create({
        data: {
          disputeId: dispute.id,
          authorId: author.id,
          body: input.body,
          fileKeys: input.fileKeys,
          isInternal: input.isInternal,
        },
      });

      // Le premier message de l'équipe fait passer la réclamation en examen :
      // le client voit que quelqu'un s'en occupe.
      if (isAdmin && !input.isInternal && dispute.status === 'OPEN') {
        await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: 'UNDER_REVIEW' },
        });
      }

      return created;
    });

    return { id: message.id };
  }

  // ═══════════════════════════════ Arbitrage

  /**
   * L'administration tranche.
   *
   * Remboursement : **100 % du prix produit**, jamais partiel — règle du
   * cahier client. Les frais de livraison et la commission restent acquis,
   * sauf geste commercial explicite.
   */
  async resolve(
    reference: string,
    adminId: string,
    input: ResolveDisputeInput,
  ): Promise<{ status: string; refundXof: number }> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { reference },
      include: {
        subOrder: true,
        order: { select: { id: true, reference: true, customerId: true, shipPhone: true } },
      },
    });
    if (!dispute) throw new NotFoundException();

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cette réclamation a déjà été tranchée.');
    }
    if (!dispute.subOrder) {
      throw new BadRequestException('Réclamation sans sous-commande rattachée.');
    }

    const subOrder = dispute.subOrder;
    const refund = input.decision === 'REFUND';

    const productRefundXof = refund ? subOrder.itemsMakerSubtotalXof : 0;
    const deliveryRefundXof = refund && input.refundDelivery ? subOrder.deliveryFeeXof : 0;
    const refundXof = productRefundXof + deliveryRefundXof;

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          status: refund ? 'RESOLVED' : 'REJECTED',
          resolution: refund ? (input.refundDelivery ? 'refund_full' : 'refund_product') : 'rejected',
          refundXof: refund ? refundXof : null,
          resolvedBy: adminId,
          resolvedAt: new Date(),
        },
      });

      await tx.disputeMessage.create({
        data: { disputeId: dispute.id, authorId: adminId, body: input.note },
      });

      if (refund) {
        await this.ledger.recordDisputeRefund(tx, {
          id: dispute.id,
          reference: dispute.reference,
          makerId: subOrder.makerId,
          customerId: dispute.order.customerId,
          productRefundXof,
          deliveryRefundXof,
          chargeToMaker: input.chargeToMaker,
        });

        await tx.refund.create({
          data: {
            paymentId: await this.paymentIdFor(tx, dispute.orderId),
            orderId: dispute.orderId,
            amountXof: refundXof,
            reason: `${dispute.reference} — ${input.note}`,
            requestedBy: adminId,
          },
        });

        /* Un créateur tenu pour responsable ne sera pas payé : le versement
           programmé, s'il existe, est annulé. */
        if (input.chargeToMaker) {
          await tx.payoutItem.updateMany({
            where: { subOrderId: subOrder.id, status: { in: ['SCHEDULED', 'READY'] } },
            data: { status: 'CANCELLED', failureReason: `Remboursé — ${dispute.reference}` },
          });
        }

        await tx.subOrder.update({ where: { id: subOrder.id }, data: { status: 'CANCELLED' } });
        await tx.order.update({
          where: { id: dispute.orderId },
          data: { status: 'REFUNDED' },
        });
      } else {
        /* Réclamation rejetée : la livraison est réputée conforme. La
           sous-commande reprend son cours normal — le créateur sera payé. */
        await tx.subOrder.update({
          where: { id: subOrder.id },
          data: { status: 'DELIVERED' },
        });
        await tx.order.update({
          where: { id: dispute.orderId },
          data: { status: 'DELIVERED' },
        });
        await tx.shipment.updateMany({
          where: { subOrderId: subOrder.id, status: 'RETURN_REQUIRED' },
          data: { status: 'DELIVERED' },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: refund ? 'dispute.refund' : 'dispute.reject',
          targetType: 'Dispute',
          targetId: dispute.id,
          after: { refundXof, chargeToMaker: input.chargeToMaker, note: input.note },
        },
      });
    });

    await this.sms.send({
      to: dispute.order.shipPhone,
      body: refund
        ? `Ojà — réclamation ${dispute.reference} : remboursement de ${refundXof} F CFA accepté.`
        : `Ojà — réclamation ${dispute.reference} : votre demande n'a pas été retenue. Consultez le détail dans votre espace.`,
    });

    /* Le SMS annonce la décision, l'e-mail en porte la motivation complète.
       Une décision sans motif se conteste, et l'échange recommence. */
    await this.notifications.disputeResolved(dispute.id);

    this.logger.log(
      `${dispute.reference} ${refund ? `remboursée (${refundXof} F CFA)` : 'rejetée'} par ${adminId}`,
    );

    return { status: refund ? 'RESOLVED' : 'REJECTED', refundXof };
  }

  /**
   * Réclamations dont le délai de traitement est dépassé.
   *
   * Un client qui attend sans nouvelle appelle, puis renonce. Le dépassement
   * doit être visible avant qu'il ne s'en aperçoive.
   */
  async listOverdue(): Promise<{ reference: string; hoursLate: number }[]> {
    const overdue = await this.prisma.dispute.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, slaDueAt: { lt: new Date() } },
      select: { reference: true, slaDueAt: true },
      orderBy: { slaDueAt: 'asc' },
    });

    return overdue.map((dispute) => ({
      reference: dispute.reference,
      hoursLate: Math.floor((Date.now() - dispute.slaDueAt.getTime()) / 3_600_000),
    }));
  }

  // ═══════════════════════════════ Utilitaires

  private async isParty(
    dispute: { orderId: string; subOrder?: { makerId: string } | null },
    userId: string,
  ): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: dispute.orderId },
      select: { customerId: true },
    });
    if (order?.customerId === userId) return true;

    if (dispute.subOrder) {
      const maker = await this.prisma.makerProfile.findUnique({
        where: { id: dispute.subOrder.makerId },
        select: { userId: true },
      });
      if (maker?.userId === userId) return true;
    }

    return false;
  }

  /**
   * Paiement en ligne à rembourser, s'il y en a un. Une commande réglée à la
   * livraison n'en a pas : le remboursement est alors rendu en espèces ou par
   * virement par l'équipe, d'où un `null` et non une erreur.
   */
  private async paymentIdFor(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<string | null> {
    const payment = await tx.payment.findFirst({
      where: { orderId, status: 'PAID' },
      select: { id: true },
    });
    return payment?.id ?? null;
  }

  /**
   * Compose les vues en résolvant d'un coup qui, parmi les auteurs, appartient
   * à l'équipe Ojà.
   *
   * Le drapeau compte : le client doit distinguer la réponse du Support de
   * celle de l'atelier — d'autant qu'ici les deux parties ne se parlent
   * jamais directement.
   */
  private async toViews(
    disputes: Parameters<DisputeService['toView']>[0][],
    includeInternal: boolean,
  ): Promise<DisputeView[]> {
    const authorIds = [
      ...new Set(disputes.flatMap((d) => d.messages.map((m) => m.authorId))),
    ];

    const admins = authorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds }, role: 'ADMIN' },
          select: { id: true },
        })
      : [];
    const adminIds = new Set(admins.map((admin) => admin.id));

    return disputes.map((dispute) => this.toView(dispute, includeInternal, adminIds));
  }

  private toView(
    dispute: {
      reference: string;
      status: string;
      reason: string;
      resolution: string | null;
      refundXof: number | null;
      slaDueAt: Date;
      subOrderId: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
      order: { reference: string };
      messages: {
        id: string;
        authorId: string;
        body: string;
        fileKeys: string[];
        isInternal: boolean;
        createdAt: Date;
      }[];
    },
    includeInternal: boolean,
    adminIds: ReadonlySet<string> = new Set(),
  ): DisputeView {
    return {
      reference: dispute.reference,
      orderReference: dispute.order.reference,
      subOrderReference: dispute.subOrderId,
      status: dispute.status as DisputeView['status'],
      statusLabel: STATUS_LABELS[dispute.status] ?? dispute.status,
      reason: dispute.reason as DisputeReason,
      reasonLabel: DISPUTE_REASON_LABELS[dispute.reason as DisputeReason] ?? dispute.reason,
      resolution: dispute.resolution,
      refundXof: dispute.refundXof,
      slaDueAt: dispute.slaDueAt.toISOString(),
      overdue:
        dispute.slaDueAt < new Date() &&
        (dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'),
      // Les notes d'équipe ne sortent jamais vers une partie.
      messages: dispute.messages
        .filter((message) => includeInternal || !message.isInternal)
        .map((message) => ({
          id: message.id,
          authorId: message.authorId,
          fromAdmin: adminIds.has(message.authorId),
          body: message.body,
          fileKeys: message.fileKeys,
          createdAt: message.createdAt.toISOString(),
        })),
      createdAt: dispute.createdAt.toISOString(),
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    };
  }
}
