import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@oja/db';
import {
  assertSubOrderTransition,
  autoValidateAt,
  deriveOrderStatus,
  payoutReleaseAt,
} from '@oja/domain';

import { LedgerService } from '../ledger/ledger.service';
import { SmsService } from '../notifications/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Validation à la réception.
 *
 * C'est **le** moment qui décide du sort de l'argent. Le cahier client est
 * net : à réception, le client inspecte, puis clique « Valider la réception »
 * ou « Signaler un problème ». Le versement au créateur part 24 h après la
 * validation.
 */
@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);
  private readonly holdHours: number;
  private readonly autoValidateHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.holdHours = config.get<number>('PAYOUT_HOLD_HOURS', 24);
    this.autoValidateHours = config.get<number>('AUTO_VALIDATE_HOURS', 72);
  }

  /**
   * Le client valide la réception.
   *
   * Il valide **une sous-commande**, pas la commande entière : chaque atelier
   * livre séparément, et le client ne peut pas se prononcer sur un colis qu'il
   * n'a pas encore reçu.
   */
  async validate(userId: string, subOrderReference: string): Promise<{
    status: string;
    payoutAt: string;
  }> {
    const subOrder = await this.requireOwn(userId, subOrderReference);
    assertSubOrderTransition(subOrder.status, 'VALIDATED');

    const validatedAt = new Date();
    const releaseAt = payoutReleaseAt(validatedAt, this.holdHours);

    await this.prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: subOrder.id },
        data: { status: 'VALIDATED', validatedAt },
      });

      const maker = await tx.makerProfile.findUniqueOrThrow({
        where: { id: subOrder.makerId },
        select: {
          userId: true,
          payoutMethod: true,
          payoutMsisdn: true,
          payoutOperator: true,
        },
      });

      /* Le versement est **programmé**, pas exécuté : il devient dû à
         l'échéance. L'exécution réelle — le virement Mobile Money — est le
         dernier maillon, au lot paiement. Le grand livre, lui, sait déjà
         exactement ce qui est dû à qui. */
      await tx.payoutItem.create({
        data: {
          beneficiaryId: maker.userId,
          beneficiaryRole: 'MAKER',
          subOrderId: subOrder.id,
          amountXof: subOrder.itemsMakerSubtotalXof,
          method: maker.payoutMethod,
          msisdn: maker.payoutMsisdn,
          operator: maker.payoutOperator,
          status: 'SCHEDULED',
          releaseAt,
        },
      });

      await this.refreshOrder(tx, subOrder.orderId);
    });

    await this.notifications.subOrderValidated(subOrder.id);

    this.logger.log(
      `${subOrderReference} validée — versement programmé le ${releaseAt.toISOString()}`,
    );

    return { status: 'VALIDATED', payoutAt: releaseAt.toISOString() };
  }

  /**
   * Le client signale un problème.
   *
   * Le versement au créateur ne part pas, un litige s'ouvre et le livreur voit
   * « produit à retourner ». Conformément au cahier client, le remboursement
   * portera sur **100 % du prix produit** ; les frais de livraison et la
   * commission restent acquis.
   */
  async reportProblem(
    userId: string,
    subOrderReference: string,
    reason: string,
    description: string,
  ): Promise<{ status: string; disputeReference: string }> {
    const subOrder = await this.requireOwn(userId, subOrderReference);

    if (subOrder.status !== 'DELIVERED') {
      throw new BadRequestException(
        'Un problème ne peut être signalé qu’à la réception de la commande.',
      );
    }

    const { reference, disputeId } = await this.prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const counter = await tx.referenceCounter.upsert({
        where: { scope_year: { scope: 'dispute', year } },
        update: { value: { increment: 1 } },
        create: { scope: 'dispute', year, value: 1 },
      });
      const disputeReference = `REC-${year}-${String(counter.value).padStart(5, '0')}`;

      const dispute = await tx.dispute.create({
        data: {
          reference: disputeReference,
          orderId: subOrder.orderId,
          subOrderId: subOrder.id,
          openedById: userId,
          reason,
          status: 'OPEN',
          // 72 h pour trancher : au-delà, le client attend sans savoir.
          slaDueAt: new Date(Date.now() + 72 * 3_600_000),
        },
      });

      await tx.disputeMessage.create({
        data: { disputeId: dispute.id, authorId: userId, body: description },
      });

      // Le colis repart : le livreur voit « produit à retourner ».
      await tx.shipment.updateMany({
        where: { subOrderId: subOrder.id, status: 'DELIVERED' },
        data: { status: 'RETURN_REQUIRED' },
      });

      await tx.order.update({
        where: { id: subOrder.orderId },
        data: { status: 'DISPUTED' },
      });

      return { reference: disputeReference, disputeId: dispute.id };
    });

    // L'équipe Ojà doit prendre le litige en charge — un litige non vu, c'est
    // un client qui attend et un versement suspendu (LN-10).
    await this.notifications.disputeOpened(disputeId);

    this.logger.warn(`Problème signalé sur ${subOrderReference} → ${reference}`);
    return { status: 'DISPUTED', disputeReference: reference };
  }

  /**
   * Valide automatiquement les livraisons restées sans réponse.
   *
   * Le cahier client ne prévoit pas ce cas. Sans échéance, un client passif
   * priverait le créateur de son paiement indéfiniment — il a livré, il a fait
   * son travail. 72 h par défaut, à confirmer (SPEC-ALIGNEMENT § 9-A).
   *
   * Deux relances partent avant, à 24 h et 48 h : la validation automatique ne
   * doit surprendre personne.
   */
  async autoValidateStale(): Promise<{ validated: number; reminded: number }> {
    const now = new Date();

    const delivered = await this.prisma.subOrder.findMany({
      where: { status: 'DELIVERED', deliveredAt: { not: null } },
      include: {
        order: { select: { customerId: true, reference: true, shipPhone: true } },
      },
    });

    let validated = 0;
    let reminded = 0;

    for (const subOrder of delivered) {
      if (!subOrder.deliveredAt) continue;
      const deadline = autoValidateAt(subOrder.deliveredAt, this.autoValidateHours);

      if (now >= deadline) {
        await this.validate(subOrder.order.customerId, subOrder.reference);
        validated++;
        continue;
      }

      const hoursSince = (now.getTime() - subOrder.deliveredAt.getTime()) / 3_600_000;
      if (hoursSince >= 24) {
        await this.sms.send({
          to: subOrder.order.shipPhone,
          body:
            `Ojà — avez-vous bien reçu votre commande ${subOrder.order.reference} ? ` +
            'Validez la réception dans votre espace, ou signalez un problème.',
        });
        reminded++;
      }
    }

    if (validated > 0) this.logger.log(`${validated} réception(s) validée(s) automatiquement`);
    return { validated, reminded };
  }

  /**
   * Libère les versements échus.
   *
   * À l'échéance, la dette envers le créateur passe de « programmée » à
   * « prête à verser ». L'exécution du virement viendra au lot paiement ;
   * le grand livre, lui, est déjà juste.
   */
  async releaseDuePayouts(): Promise<number> {
    const due = await this.prisma.payoutItem.findMany({
      where: { status: 'SCHEDULED', releaseAt: { lte: new Date() } },
      select: { id: true },
    });

    if (due.length === 0) return 0;

    await this.prisma.payoutItem.updateMany({
      where: { id: { in: due.map((item) => item.id) } },
      data: { status: 'READY', releasedAt: new Date() },
    });

    /* Avis au bénéficiaire — fabricant ou livreur (LN-09). Ici les fonds
       passent de « programmés » à « prêts » ; l'avis de virement effectué
       viendra se brancher au même endroit une fois L5 livré. */
    for (const item of due) {
      await this.notifications.payoutReleased(item.id);
    }

    this.logger.log(`${due.length} versement(s) prêt(s) à exécuter`);
    return due.length;
  }

  /**
   * Solde d'un créateur : ce qui lui est dû, et ce qui est déjà libéré.
   *
   * Le détail accompagne les totaux. Un artisan à qui l'on annonce « 340 000 F
   * à venir » sans dire de quelles commandes ni à quelle date n'a aucun moyen
   * de rapprocher le chiffre de son propre carnet.
   */
  async makerBalance(userId: string): Promise<{
    owedXof: number;
    scheduledXof: number;
    readyXof: number;
    paidXof: number;
    items: {
      id: string;
      amountXof: number;
      status: string;
      method: string;
      subOrderReference: string | null;
      releaseAt: string | null;
      paidAt: string | null;
      failureReason: string | null;
      createdAt: string;
    }[];
  }> {
    const [owed, grouped, items] = await Promise.all([
      this.ledger.balanceOf('MAKER_PAYABLE', userId),
      this.prisma.payoutItem.groupBy({
        by: ['status'],
        where: { beneficiaryId: userId },
        _sum: { amountXof: true },
      }),
      this.prisma.payoutItem.findMany({
        where: { beneficiaryId: userId },
        include: { subOrder: { select: { reference: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const byStatus = new Map(grouped.map((item) => [item.status, item._sum.amountXof ?? 0]));

    return {
      // Le solde du grand livre est un crédit : on l'affiche en positif.
      owedXof: -owed,
      scheduledXof: byStatus.get('SCHEDULED') ?? 0,
      readyXof: byStatus.get('READY') ?? 0,
      paidXof: byStatus.get('PAID') ?? 0,
      items: items.map((item) => ({
        id: item.id,
        amountXof: item.amountXof,
        status: item.status,
        method: item.method,
        subOrderReference: item.subOrder?.reference ?? null,
        releaseAt: item.releaseAt?.toISOString() ?? null,
        paidAt: item.paidAt?.toISOString() ?? null,
        failureReason: item.failureReason,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private async refreshOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const [statuses, paid] = await Promise.all([
      tx.subOrder.findMany({ where: { orderId }, select: { status: true } }),
      tx.order.findFirst({ where: { id: orderId, placedAt: { not: null } }, select: { id: true } }),
    ]);

    const next = deriveOrderStatus(
      statuses.map((s) => s.status),
      paid !== null,
    );

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: next,
        ...(next === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(next === 'VALIDATED' ? { validatedAt: new Date() } : {}),
      },
    });
  }

  /** Un client qui vise la commande d'un autre reçoit 404, jamais 403. */
  private async requireOwn(userId: string, reference: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { reference, order: { customerId: userId } },
    });
    if (!subOrder) throw new NotFoundException();
    return subOrder;
  }
}
