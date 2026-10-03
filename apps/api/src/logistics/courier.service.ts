import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CourierCashView,
  CourierEarnings,
  CourierProfileInput,
  CourierProfileUpdateInput,
  CourierProfileView,
  CourierRemittanceInput,
  KycReviewInput,
} from '@oja/contracts';
import type { CourierProfile, User } from '@oja/db';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Dossier et gains du livreur.
 *
 * Le cycle est celui du créateur — profil, pièces, dépôt, validation — mais
 * les pièces attendues diffèrent : un permis et une carte grise plutôt qu'un
 * RCCM. La règle qui compte est la même : **un livreur non validé n'apparaît
 * dans aucune liste d'affectation**, et le filtre est posé dans la requête,
 * pas dans l'écran.
 */

type CourierWithUser = CourierProfile & {
  user: Pick<User, 'firstName' | 'lastName'>;
};

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly ledger: LedgerService,
  ) {}

  async createProfile(userId: string, input: CourierProfileInput): Promise<CourierProfileView> {
    const existing = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('Votre profil livreur existe déjà.');

    const courier = await this.prisma.courierProfile.create({
      data: {
        userId,
        vehicle: input.vehicle,
        plateNumber: input.plateNumber,
        ...(input.payoutMsisdn !== undefined ? { payoutMsisdn: input.payoutMsisdn } : {}),
        ...(input.payoutOperator !== undefined ? { payoutOperator: input.payoutOperator } : {}),
      },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    return this.toView(courier);
  }

  async myProfile(userId: string): Promise<CourierProfileView> {
    const courier = await this.prisma.courierProfile.findUnique({
      where: { userId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');
    return this.toView(courier);
  }

  async updateProfile(
    userId: string,
    input: CourierProfileUpdateInput,
  ): Promise<CourierProfileView> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');

    /* Changer de véhicule après validation, c'est changer ce que
       l'administration a vérifié sur la carte grise — et ce que le système
       croit pouvoir charger. Le dossier repasse devant elle. */
    const changesVehicle = input.vehicle !== undefined && input.vehicle !== courier.vehicle;

    const updated = await this.prisma.courierProfile.update({
      where: { userId },
      data: {
        ...(input.vehicle !== undefined ? { vehicle: input.vehicle } : {}),
        ...(input.plateNumber !== undefined ? { plateNumber: input.plateNumber } : {}),
        ...(input.payoutMsisdn !== undefined ? { payoutMsisdn: input.payoutMsisdn } : {}),
        ...(input.payoutOperator !== undefined ? { payoutOperator: input.payoutOperator } : {}),
        ...(changesVehicle && courier.kycStatus === 'APPROVED'
          ? { kycStatus: 'PENDING' as const, isAvailable: false }
          : {}),
      },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    if (changesVehicle && courier.kycStatus === 'APPROVED') {
      this.logger.log(`Livreur ${courier.id} repasse en validation : changement de véhicule`);
    }

    return this.toView(updated);
  }

  async submitKyc(userId: string): Promise<{ status: string }> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');
    if (courier.kycStatus === 'APPROVED') {
      throw new ConflictException('Votre dossier est déjà validé.');
    }

    // Tous les manques d'un coup : renvoyer cinq fois de suite pour un champ
    // à la fois est le meilleur moyen de perdre un candidat.
    const documents = await this.prisma.kycDocument.findMany({
      where: { courierId: courier.id },
      select: { type: true },
    });
    const deposited = new Set(documents.map((document) => document.type));

    const missing: string[] = [];
    if (!courier.plateNumber) missing.push("numéro d'immatriculation");
    if (!deposited.has('cni_recto')) missing.push("pièce d'identité (recto)");
    if (!deposited.has('permis')) missing.push('permis de conduire');
    if (!deposited.has('carte_grise')) missing.push('carte grise du véhicule');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Complétez votre dossier avant de le déposer : ${missing.join(', ')}.`,
      );
    }

    await this.prisma.courierProfile.update({
      where: { userId },
      data: { kycStatus: 'PENDING', kycSubmittedAt: new Date(), kycRejectReason: null },
    });

    return { status: 'PENDING' };
  }

  // ═══════════════════════════════ Espèces encaissées à la livraison

  /** Livreurs qui détiennent des espèces d'Ojà, avec le montant à récupérer. */
  async cashHeld(): Promise<CourierCashView[]> {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { type: 'COURIER_CASH_HELD', ownerId: { not: null } },
      select: { id: true, ownerId: true },
    });
    if (accounts.length === 0) return [];

    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accounts.map((account) => account.id) } },
      _sum: { amountXof: true },
    });
    const heldByAccount = new Map(sums.map((row) => [row.accountId, row._sum.amountXof ?? 0]));

    const couriers = await this.prisma.courierProfile.findMany({
      where: { userId: { in: accounts.map((account) => account.ownerId!) } },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    const byUser = new Map(couriers.map((courier) => [courier.userId, courier]));

    return accounts
      .map((account) => {
        const courier = byUser.get(account.ownerId!);
        return courier
          ? {
              courierId: courier.id,
              userId: courier.userId,
              fullName: `${courier.user.firstName} ${courier.user.lastName}`,
              cashHeldXof: heldByAccount.get(account.id) ?? 0,
            }
          : null;
      })
      .filter((row): row is CourierCashView => row !== null && row.cashHeldXof !== 0)
      .sort((a, b) => b.cashHeldXof - a.cashHeldXof);
  }

  /**
   * Enregistre qu'un livreur a reversé des espèces à Ojà.
   *
   * On refuse un montant supérieur à ce qu'il détient : il rendrait son
   * compte négatif, c'est-à-dire que c'est Ojà qui lui devrait de l'argent sur
   * une erreur de saisie.
   */
  async recordRemittance(
    courierId: string,
    adminId: string,
    input: CourierRemittanceInput,
  ): Promise<CourierCashView> {
    const courier = await this.prisma.courierProfile.findUnique({
      where: { id: courierId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!courier) throw new NotFoundException();

    await this.prisma.$transaction(async (tx) => {
      const held = await this.ledger.balanceOfIn(tx, 'COURIER_CASH_HELD', courier.userId);
      if (input.amountXof > held) {
        throw new BadRequestException(
          `Ce livreur ne détient que ${held} F CFA : impossible d'enregistrer ${input.amountXof} F CFA.`,
        );
      }

      await this.ledger.recordCourierRemittance(tx, {
        courierUserId: courier.userId,
        amountXof: input.amountXof,
        ...(input.note ? { memo: input.note } : {}),
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'courier.cash.remitted',
          targetType: 'CourierProfile',
          targetId: courierId,
          after: { amountXof: input.amountXof, note: input.note ?? null },
        },
      });
    });

    this.logger.log(`Reversement de ${input.amountXof} F CFA enregistré pour le livreur ${courierId}`);
    return {
      courierId,
      userId: courier.userId,
      fullName: `${courier.user.firstName} ${courier.user.lastName}`,
      cashHeldXof: await this.ledger.balanceOf('COURIER_CASH_HELD', courier.userId),
    };
  }

  // ═══════════════════════════════ Administration

  async listForAdmin(status?: string): Promise<CourierProfileView[]> {
    const couriers = await this.prisma.courierProfile.findMany({
      where: status ? { kycStatus: status as 'PENDING' } : {},
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ kycSubmittedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });

    const counts = await this.deliveredCounts(couriers.map((courier) => courier.id));
    return couriers.map((courier) => this.toView(courier, counts.get(courier.id) ?? 0));
  }

  async reviewKyc(
    courierId: string,
    adminId: string,
    input: KycReviewInput,
  ): Promise<CourierProfileView> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { id: courierId } });
    if (!courier) throw new NotFoundException();

    if (input.decision === 'REJECT' && !input.reason) {
      throw new BadRequestException('Un refus doit être motivé.');
    }

    const approved = input.decision === 'APPROVE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.courierProfile.update({
        where: { id: courierId },
        data: {
          kycStatus: approved ? 'APPROVED' : 'REJECTED',
          kycReviewedAt: new Date(),
          kycRejectReason: approved ? null : (input.reason ?? null),
          /* Un refus retire la disponibilité : sans cela, un livreur refusé
             resterait dans la file d'affectation jusqu'à ce qu'il se déclare
             lui-même indisponible. */
          ...(approved ? {} : { isAvailable: false }),
        },
        include: { user: { select: { firstName: true, lastName: true } } },
      });

      /* Le compte utilisateur suit la décision, comme pour un créateur.
         Sans cette ligne, un livreur validé reste au statut « en attente » :
         `suggestCouriers` ne retient que les comptes actifs, il n'apparaît
         donc dans aucune liste d'affectation — validé, disponible, et
         pourtant introuvable. */
      await tx.user.update({
        where: { id: profile.userId },
        data: { status: approved ? 'ACTIVE' : 'REJECTED' },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: approved ? 'courier.approve' : 'courier.reject',
          targetType: 'CourierProfile',
          targetId: courierId,
          ...(input.reason ? { after: { kycRejectReason: input.reason } } : {}),
        },
      });

      return profile;
    });

    await this.notifications.kycDecision(
      courier.userId,
      approved,
      'COURIER',
      input.reason ?? null,
    );

    this.logger.log(`Livreur ${courierId} ${approved ? 'validé' : 'refusé'}`);
    return this.toView(updated);
  }

  // ═══════════════════════════════ Gains

  /**
   * Ce que le livreur a gagné, et ce qui l'attend.
   *
   * Le montant provisionné est aujourd'hui la totalité des frais de livraison,
   * faute de règle de rémunération arrêtée. L'écran l'annonce ; il ne prétend
   * pas à un chiffre définitif.
   */
  async earnings(userId: string): Promise<CourierEarnings> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');

    const [delivered, grouped, items, cashHeldXof] = await Promise.all([
      /* On agrège sur ses propres courses livrées. Le compte COURIER_PAYABLE
         du grand livre ne convient pas : il est provisionné à l'encaissement,
         quand aucun livreur n'est encore affecté, donc sans propriétaire. */
      this.prisma.shipment.aggregate({
        where: { courierId: courier.id, status: 'DELIVERED' },
        _sum: { feeXof: true },
        _count: { _all: true },
      }),
      this.prisma.payoutItem.groupBy({
        by: ['status'],
        where: { beneficiaryId: userId },
        _sum: { amountXof: true },
      }),
      this.prisma.payoutItem.findMany({
        where: { beneficiaryId: userId },
        include: { shipment: { select: { reference: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.ledger.balanceOf('COURIER_CASH_HELD', userId),
    ]);

    const byStatus = new Map(grouped.map((item) => [item.status, item._sum.amountXof ?? 0]));

    return {
      deliveryFeesCollectedXof: delivered._sum.feeXof ?? 0,
      cashHeldXof,
      scheduledXof: byStatus.get('SCHEDULED') ?? 0,
      readyXof: byStatus.get('READY') ?? 0,
      paidXof: byStatus.get('PAID') ?? 0,
      deliveredCount: delivered._count._all,
      items: items.map((item) => ({
        id: item.id,
        amountXof: item.amountXof,
        status: item.status,
        shipmentReference: item.shipment?.reference ?? null,
        releaseAt: item.releaseAt?.toISOString() ?? null,
        paidAt: item.paidAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  // ═══════════════════════════════ Utilitaires

  private async deliveredCounts(courierIds: string[]): Promise<Map<string, number>> {
    if (courierIds.length === 0) return new Map();

    const rows = await this.prisma.shipment.groupBy({
      by: ['courierId'],
      where: { courierId: { in: courierIds }, status: 'DELIVERED' },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row): row is typeof row & { courierId: string } => row.courierId !== null)
        .map((row) => [row.courierId, row._count._all]),
    );
  }

  private toView(courier: CourierWithUser, deliveredCount = 0): CourierProfileView {
    return {
      id: courier.id,
      userId: courier.userId,
      fullName: `${courier.user.firstName} ${courier.user.lastName}`,
      vehicle: courier.vehicle,
      plateNumber: courier.plateNumber,
      payoutMsisdn: courier.payoutMsisdn,
      payoutOperator: courier.payoutOperator,
      isAvailable: courier.isAvailable,
      ratingAvg: courier.ratingAvg,
      kycStatus: courier.kycStatus,
      kycSubmittedAt: courier.kycSubmittedAt?.toISOString() ?? null,
      kycRejectReason: courier.kycRejectReason,
      deliveredCount,
    };
  }
}
