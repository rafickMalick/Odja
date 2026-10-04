import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, SubOrderStatus } from '@oja/db';
import {
  assertSubOrderTransition,
  deriveOrderStatus,
  needsProduction,
  productionDaysFor,
  SUB_ORDER_LABELS,
} from '@oja/domain';

import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notification.service';
import { ShipmentService } from '../logistics/shipment.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cycle de vie d'une sous-commande, côté créateur.
 *
 * Les libellés sont ceux du cahier client : « Commande reçue », « Paiement
 * confirmé », « En fabrication », « Prêt à récupérer », « En cours de
 * livraison ». Ils ne sont pas reformulés — ce sont les mots que l'atelier
 * lira à l'écran.
 */
@Injectable()
export class SubOrderService {
  private readonly logger = new Logger(SubOrderService.name);
  private readonly acceptHours: number;
  private readonly reminderLeadHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly shipments: ShipmentService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.acceptHours = config.get<number>('SUBORDER_ACCEPT_HOURS', 48);
    this.reminderLeadHours = config.get<number>('SUBORDER_REMINDER_LEAD_HOURS', 12);
  }

  async listForMaker(userId: string, scope: 'current' | 'past' = 'current') {
    const maker = await this.requireMaker(userId);

    /* Le cahier client demande deux onglets : « Commandes en cours » et
       « Produits vendus ». Le second est l'historique de ce qui est allé au
       bout, pas une liste de produits. */
    const current: SubOrderStatus[] = [
      'RECEIVED',
      'PAYMENT_CONFIRMED',
      'IN_PRODUCTION',
      'READY_FOR_PICKUP',
      'IN_DELIVERY',
    ];
    const past: SubOrderStatus[] = ['DELIVERED', 'VALIDATED', 'REJECTED', 'CANCELLED'];

    const subOrders = await this.prisma.subOrder.findMany({
      where: { makerId: maker.id, status: { in: scope === 'current' ? current : past } },
      include: { lines: true, order: { select: { reference: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return subOrders.map((subOrder) => ({
      reference: subOrder.reference,
      orderReference: subOrder.order.reference,
      status: subOrder.status,
      statusLabel: SUB_ORDER_LABELS[subOrder.status],
      lines: subOrder.lines.map((line) => ({
        productName: line.productName,
        quantity: line.quantity,
        makerPriceXof: line.makerPriceXof,
      })),
      /* Le créateur voit ce qu'il touchera, pas ce que le client a payé : la
         commission et la livraison ne le concernent pas. */
      itemsMakerSubtotalXof: subOrder.itemsMakerSubtotalXof,
      respondByAt: subOrder.respondByAt?.toISOString() ?? null,
      dueReadyAt: subOrder.dueReadyAt?.toISOString() ?? null,
      createdAt: subOrder.createdAt.toISOString(),
    }));
  }

  /**
   * L'atelier accepte la commande.
   *
   * C'est ici qu'on arme le compte à rebours de fabrication, à partir du délai
   * saisi sur la fiche produit — pas d'une valeur générique. L'atelier a
   * annoncé quinze jours, on compte quinze jours.
   */
  async accept(userId: string, reference: string): Promise<{ status: string; dueReadyAt: string | null }> {
    const subOrder = await this.requireOwn(userId, reference);
    assertSubOrderTransition(subOrder.status, 'IN_PRODUCTION');

    const lines = subOrder.lines.map((line) => ({
      isMadeToOrder: line.product.isMadeToOrder,
      leadTimeDays: line.product.leadTimeDays,
    }));

    /* Une pièce en stock n'a rien à fabriquer : elle est prête à enlever tout
       de suite. Faire passer l'atelier par « En fabrication » pour un tabouret
       posé sur son étagère lui ferait cliquer deux fois pour rien. */
    const production = needsProduction(lines);
    const target: SubOrderStatus = production ? 'IN_PRODUCTION' : 'READY_FOR_PICKUP';
    const dueReadyAt = production
      ? new Date(Date.now() + productionDaysFor(lines) * 86_400_000)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: subOrder.id },
        data: {
          status: target,
          acceptedAt: new Date(),
          dueReadyAt,
          ...(target === 'READY_FOR_PICKUP' ? { readyAt: new Date() } : {}),
        },
      });
      await this.refreshOrderStatus(tx, subOrder.orderId);
    });

    /* L'expédition naît hors de la transaction : elle envoie un SMS au client
       avec son code de réception, et un envoi qui échoue ne doit pas annuler
       l'acceptation de l'atelier. */
    if (target === 'READY_FOR_PICKUP') {
      await this.shipments.createForReadySubOrder(subOrder.id);
    }

    return { status: target, dueReadyAt: dueReadyAt?.toISOString() ?? null };
  }

  /**
   * L'atelier refuse la commande.
   *
   * Sa part est rendue au client et son stock relâché. Les autres ateliers de
   * la même commande continuent : un refus n'annule pas ce que les autres ont
   * accepté.
   */
  async reject(
    userId: string,
    reference: string,
    reason: string,
  ): Promise<{ status: string }> {
    const subOrder = await this.requireOwn(userId, reference);
    assertSubOrderTransition(subOrder.status, 'REJECTED');

    if (!reason.trim()) {
      // Sans motif, le client ne sait pas s'il doit recommander ailleurs ou
      // patienter, et le support reçoit l'appel.
      throw new BadRequestException('Indiquez pourquoi vous ne pouvez pas honorer cette commande.');
    }

    await this.cancelSubOrder(subOrder.id, 'REJECTED', reason);
    /* Hors transaction : le client doit apprendre l'annulation, mais un relais
       SMTP en panne ne doit pas rendre son argent deux fois. */
    await this.notifications.subOrderRejected(subOrder.id, reason);
    return { status: 'REJECTED' };
  }

  /** L'atelier déclare la pièce prête à être enlevée. */
  async markReady(userId: string, reference: string): Promise<{ status: string }> {
    const subOrder = await this.requireOwn(userId, reference);
    assertSubOrderTransition(subOrder.status, 'READY_FOR_PICKUP');

    await this.prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: subOrder.id },
        data: { status: 'READY_FOR_PICKUP', readyAt: new Date() },
      });
      await this.refreshOrderStatus(tx, subOrder.orderId);
    });

    await this.shipments.createForReadySubOrder(subOrder.id);
    return { status: 'READY_FOR_PICKUP' };
  }

  /**
   * Refuse automatiquement les sous-commandes restées sans réponse.
   *
   * Le cahier client ne prévoit pas ce cas. Sans lui, une commande reste
   * bloquée indéfiniment sur un atelier injoignable, l'argent du client est
   * immobilisé et personne ne sait quoi faire. Le silence vaut refus
   * (SPEC-ALIGNEMENT § 9-D).
   */
  async expireUnanswered(): Promise<number> {
    const stale = await this.prisma.subOrder.findMany({
      where: {
        status: 'PAYMENT_CONFIRMED',
        respondByAt: { lt: new Date() },
      },
      select: { id: true, reference: true },
    });

    for (const subOrder of stale) {
      const reason = `Sans réponse de l'atelier sous ${this.acceptHours} heures.`;
      await this.cancelSubOrder(subOrder.id, 'REJECTED', reason);
      await this.notifications.subOrderRejected(subOrder.id, reason);
      this.logger.warn(`${subOrder.reference} refusée automatiquement (silence)`);
    }

    return stale.length;
  }

  /**
   * Relance les ateliers dont le délai de réponse approche (cahier LN-06).
   *
   * `expireUnanswered` annule au silence ; ici on prévient **avant**, à
   * quelques heures de l'échéance. Une seule relance par sous-commande :
   * `reminderSentAt` la garde idempotente, ce qui permet de laisser la tâche
   * accessible à la main comme les autres.
   */
  async remindPending(): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + this.reminderLeadHours * 3_600_000);

    const pending = await this.prisma.subOrder.findMany({
      where: {
        status: 'PAYMENT_CONFIRMED',
        reminderSentAt: null,
        respondByAt: { gt: now, lte: horizon },
      },
      select: { id: true, reference: true, respondByAt: true },
    });

    for (const subOrder of pending) {
      const hoursLeft = Math.max(
        1,
        Math.round(((subOrder.respondByAt?.getTime() ?? now.getTime()) - now.getTime()) / 3_600_000),
      );
      await this.prisma.subOrder.update({
        where: { id: subOrder.id },
        data: { reminderSentAt: now },
      });
      await this.notifications.subOrderReminder(subOrder.id, hoursLeft);
      this.logger.log(`Relance envoyée pour ${subOrder.reference} (${hoursLeft} h restantes)`);
    }

    return pending.length;
  }

  /**
   * Annule une sous-commande : stock relâché, dette éteinte, montant rendu au
   * client dans le grand livre.
   */
  private async cancelSubOrder(
    subOrderId: string,
    status: 'REJECTED' | 'CANCELLED',
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const subOrder = await tx.subOrder.findUniqueOrThrow({
        where: { id: subOrderId },
        include: {
          lines: { include: { product: true } },
          order: { select: { id: true, customerId: true, status: true } },
        },
      });

      await tx.subOrder.update({
        where: { id: subOrderId },
        data: {
          status,
          rejectedAt: new Date(),
          rejectReason: reason,
        },
      });

      // Les pièces retournent en stock : elles n'ont pas été vendues.
      for (const line of subOrder.lines) {
        if (line.product.isMadeToOrder) continue;
        await tx.product.update({
          where: { id: line.productId },
          data: { quantityAvailable: { increment: line.quantity } },
        });
      }

      /* L'écriture comptable n'a lieu que si l'argent est déjà entré. Une
         commande annulée avant paiement n'a créé aucune dette à éteindre. */
      const confirmed = await tx.order.findFirst({
        where: { id: subOrder.orderId, placedAt: { not: null } },
        select: { id: true },
      });

      if (confirmed) {
        await this.ledger.recordSubOrderCancelled(
          tx,
          {
            id: subOrder.id,
            reference: subOrder.reference,
            makerId: subOrder.makerId,
            itemsMakerSubtotalXof: subOrder.itemsMakerSubtotalXof,
            deliveryFeeXof: subOrder.deliveryFeeXof,
            // Ce que le livreur devait encore encaisser sur cette sous-commande.
            outstandingBalanceXof: subOrder.cashCollectedAt ? 0 : subOrder.balanceDueXof,
          },
          subOrder.order.customerId,
        );
      }

      await this.refreshOrderStatus(tx, subOrder.orderId);
    });
  }

  /**
   * Recalcule le statut de la commande à partir de ses sous-commandes.
   *
   * Le client suit une commande, les ateliers travaillent chacun sur la leur :
   * le statut affiché est dérivé, jamais saisi. Sinon les deux vues divergent
   * au premier atelier qui prend de l'avance.
   */
  private async refreshOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const [subOrders, paid] = await Promise.all([
      tx.subOrder.findMany({ where: { orderId }, select: { status: true } }),
      tx.order.findFirst({ where: { id: orderId, placedAt: { not: null } }, select: { id: true } }),
    ]);

    const next = deriveOrderStatus(
      subOrders.map((subOrder) => subOrder.status),
      paid !== null,
    );

    const current = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });

    if (current.status === next) return;

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: next,
        ...(next === 'CANCELLED'
          ? { cancelledAt: new Date(), cancelReason: 'Aucun atelier ne donne suite' }
          : {}),
      },
    });
  }

  private async requireMaker(userId: string) {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');
    return maker;
  }

  /**
   * Charge une sous-commande **en s'assurant qu'elle appartient au demandeur**.
   * Un créateur qui vise celle d'un confrère reçoit 404, jamais 403.
   */
  private async requireOwn(userId: string, reference: string) {
    const maker = await this.requireMaker(userId);
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { reference, makerId: maker.id },
      include: { lines: { include: { product: true } } },
    });
    if (!subOrder) throw new NotFoundException();
    return subOrder;
  }
}
