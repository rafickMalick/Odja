import { randomInt } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, ShipmentStatus } from '@oja/db';
import {
  assessProof,
  assertShipmentTransition,
  assertSubOrderTransition,
  billableDistanceKm,
  deriveOrderStatus,
  formatDeliveryOtp,
  haversineKm,
  SHIPMENT_LABELS,
  type ProofSubmission,
} from '@oja/domain';

import { pointOf } from '../checkout/quote.service';
import { LedgerService } from '../ledger/ledger.service';
import { SmsService } from '../notifications/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { ShipmentEventsBus } from './shipment-events.bus';

/**
 * Expéditions et missions de livraison.
 *
 * Le cahier client confie l'affectation à l'administration : « Créer les
 * tournées, attribuer un livreur ». Le livreur ne choisit pas ses missions,
 * il les reçoit. C'est plus simple à construire et plus maîtrisable au
 * lancement qu'un modèle où chacun se sert.
 */
@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);
  private readonly sinuosityFactor: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationService,
    private readonly events: ShipmentEventsBus,
    private readonly ledger: LedgerService,
    config: ConfigService,
  ) {
    this.sinuosityFactor = config.get<number>('DISTANCE_SINUOSITY_FACTOR', 1.3);
  }

  /**
   * Crée l'expédition d'une sous-commande prête à enlever.
   *
   * Le véhicule et les frais ont été décidés au chiffrage : on ne les
   * recalcule pas. Le client a payé un montant, il n'a pas à en découvrir un
   * autre parce que le trafic a changé.
   */
  async createForReadySubOrder(subOrderId: string): Promise<{ reference: string }> {
    const subOrder = await this.prisma.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      include: {
        shipment: true,
        maker: { include: { city: true } },
        order: true,
        lines: { include: { product: true } },
      },
    });
    const shipCity = await this.prisma.city.findUniqueOrThrow({
      where: { id: subOrder.order.shipCityId },
    });

    if (subOrder.shipment) return { reference: subOrder.shipment.reference };
    if (subOrder.status !== 'READY_FOR_PICKUP') {
      throw new BadRequestException("Cette sous-commande n'est pas prête à enlever.");
    }

    const load = subOrder.lines.reduce(
      (total, line) => ({
        weightGrams: total.weightGrams + line.product.weightGrams * line.quantity,
        volumeL:
          total.volumeL +
          (line.product.lengthMm * line.product.widthMm * line.product.heightMm * line.quantity) /
            1_000_000,
      }),
      { weightGrams: 0, volumeL: 0 },
    );

    const distanceKm = this.distanceFor(subOrder.maker, subOrder.order, shipCity);

    /* Le code de réception est tiré maintenant et envoyé au client : il doit
       l'avoir en main avant que le livreur ne sonne. */
    const otp = formatDeliveryOtp(randomInt(0, 10_000));

    const shipment = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx);

      const created = await tx.shipment.create({
        data: {
          reference,
          orderId: subOrder.orderId,
          subOrderId: subOrder.id,
          status: 'TO_PICK_UP',
          vehicle: await this.vehicleFor(tx, subOrder.maker.cityId, load),
          distanceKm,
          totalWeightG: load.weightGrams,
          totalVolumeL: load.volumeL,
          feeXof: subOrder.deliveryFeeXof,
          pickupLine1: subOrder.maker.pickupLine1 ?? '',
          pickupLandmark: subOrder.maker.pickupLandmark,
          pickupLatitude: subOrder.maker.pickupLatitude,
          pickupLongitude: subOrder.maker.pickupLongitude,
          proofOtp: otp,
        },
      });

      await tx.shipmentEvent.create({
        data: { shipmentId: created.id, status: 'TO_PICK_UP', note: 'Expédition créée' },
      });

      return created;
    });

    await this.sms.send({
      to: subOrder.order.shipPhone,
      body:
        `Ojà — votre commande ${subOrder.order.reference} part en livraison. ` +
        `Code de réception à donner au livreur : ${otp}`,
    });

    /* Le client est prévenu que sa commande est prête et qu'un livreur va
       passer (LN-07) ; les livreurs de la zone voient l'offre dans leur
       espace — l'affectation reste à l'administration. */
    await this.notifications.subOrderReadyForPickup(subOrder.id);
    await this.notifications.courierOffer(
      shipment.id,
      await this.candidateCourierUserIds(shipment.vehicle),
    );

    return { reference: shipment.reference };
  }

  /**
   * Livreurs susceptibles de prendre une course : disponibles, validés, actifs,
   * dont le véhicule a la capacité requise. Renvoie leurs `userId` — c'est ce
   * dont les notifications ont besoin.
   */
  private async candidateCourierUserIds(vehicle: string): Promise<string[]> {
    const couriers = await this.prisma.courierProfile.findMany({
      where: { isAvailable: true, kycStatus: 'APPROVED', user: { status: 'ACTIVE' } },
      select: { userId: true, vehicle: true },
    });
    return couriers
      .filter((courier) => capacityRank(courier.vehicle) >= capacityRank(vehicle))
      .map((courier) => courier.userId);
  }

  // ═══════════════════════════════ Administration

  async listUnassigned() {
    const shipments = await this.prisma.shipment.findMany({
      where: { courierId: null, status: 'TO_PICK_UP' },
      include: {
        subOrder: { include: { maker: { select: { shopName: true } } } },
        order: { select: { reference: true, shipLine1: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return shipments.map((shipment) => ({
      reference: shipment.reference,
      orderReference: shipment.order.reference,
      shopName: shipment.subOrder.maker.shopName,
      pickupLine1: shipment.pickupLine1,
      dropLine1: shipment.order.shipLine1,
      vehicle: shipment.vehicle,
      distanceKm: shipment.distanceKm,
      weightKg: Math.round(shipment.totalWeightG / 100) / 10,
    }));
  }

  /**
   * Livreurs pouvant prendre cette expédition, les plus proches d'abord.
   *
   * L'administration décide, mais elle ne doit pas choisir dans une liste
   * brute : on lui présente les livreurs disponibles, validés, dont le
   * véhicule convient.
   */
  async suggestCouriers(shipmentReference: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { reference: shipmentReference },
    });
    if (!shipment) throw new NotFoundException();

    const couriers = await this.prisma.courierProfile.findMany({
      where: { isAvailable: true, kycStatus: 'APPROVED' },
      include: { user: { select: { firstName: true, lastName: true, status: true } } },
    });

    return couriers
      .filter((courier) => courier.user.status === 'ACTIVE')
      .map((courier) => ({
        id: courier.id,
        name: `${courier.user.firstName} ${courier.user.lastName}`,
        vehicle: courier.vehicle,
        ratingAvg: courier.ratingAvg,
        // Un véhicule plus grand que nécessaire convient ; l'inverse non.
        suitable: capacityRank(courier.vehicle) >= capacityRank(shipment.vehicle),
      }))
      .sort((a, b) => Number(b.suitable) - Number(a.suitable) || b.ratingAvg - a.ratingAvg);
  }

  async assign(
    shipmentReference: string,
    courierId: string,
    adminId: string,
    runId?: string,
  ): Promise<{ reference: string; courier: string }> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { reference: shipmentReference },
    });
    if (!shipment) throw new NotFoundException();

    const courier = await this.prisma.courierProfile.findUnique({
      where: { id: courierId },
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!courier) throw new NotFoundException('Livreur inconnu.');

    if (courier.kycStatus !== 'APPROVED') {
      throw new BadRequestException("Ce livreur n'est pas encore validé.");
    }

    if (capacityRank(courier.vehicle) < capacityRank(shipment.vehicle)) {
      // Envoyer une moto chercher un buffet fait perdre une course à tout le
      // monde, et le livreur repart à vide.
      throw new BadRequestException(
        `Cette expédition demande un ${shipment.vehicle.toLowerCase()} ; ` +
          `ce livreur a un ${courier.vehicle.toLowerCase()}.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          courierId,
          assignedBy: adminId,
          assignedAt: new Date(),
          ...(runId ? { runId } : {}),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'shipment.assign',
          targetType: 'Shipment',
          targetId: shipment.id,
          after: { courierId },
        },
      }),
    ]);

    await this.sms.send({
      to: courier.user.phone,
      body: `Ojà — nouvelle mission ${shipment.reference}. Enlèvement : ${shipment.pickupLine1}`,
    });
    /* Le SMS donne l'alerte, l'e-mail donne l'adresse complète et le lien.
       Les deux, parce qu'un livreur sur la route ne lit pas ses mails, et
       qu'un SMS ne tient pas une adresse avec point de repère. */
    await this.notifications.shipmentAssigned(shipment.id);

    return {
      reference: shipment.reference,
      courier: `${courier.user.firstName} ${courier.user.lastName}`,
    };
  }

  /** Tournée : plusieurs missions groupées pour un même livreur. */
  async createRun(
    courierId: string,
    adminId: string,
    shipmentReferences: string[],
    plannedFor: Date,
  ): Promise<{ reference: string; assigned: number }> {
    const courier = await this.prisma.courierProfile.findUnique({ where: { id: courierId } });
    if (!courier) throw new NotFoundException('Livreur inconnu.');

    const run = await this.prisma.$transaction(async (tx) => {
      const counter = await tx.referenceCounter.upsert({
        where: { scope_year: { scope: 'run', year: new Date().getFullYear() } },
        update: { value: { increment: 1 } },
        create: { scope: 'run', year: new Date().getFullYear(), value: 1 },
      });

      return tx.deliveryRun.create({
        data: {
          reference: `TRN-${new Date().getFullYear()}-${String(counter.value).padStart(5, '0')}`,
          courierId,
          plannedFor,
          createdBy: adminId,
        },
      });
    });

    let assigned = 0;
    for (const reference of shipmentReferences) {
      await this.assign(reference, courierId, adminId, run.id);
      assigned++;
    }

    return { reference: run.reference, assigned };
  }

  // ═══════════════════════════════ Espace livreur

  async myMissions(userId: string, scope: 'current' | 'past' = 'current') {
    const courier = await this.requireCourier(userId);

    const current: ShipmentStatus[] = ['TO_PICK_UP', 'PICKED_UP', 'IN_DELIVERY', 'RETURN_REQUIRED'];
    const past: ShipmentStatus[] = ['DELIVERED', 'RETURNED', 'FAILED'];

    const shipments = await this.prisma.shipment.findMany({
      where: { courierId: courier.id, status: { in: scope === 'current' ? current : past } },
      include: {
        subOrder: {
          include: {
            maker: { select: { shopName: true } },
            lines: { select: { productName: true, quantity: true } },
          },
        },
        order: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return shipments.map((shipment) => this.toMissionView(shipment));
  }

  /**
   * Vue d'une mission.
   *
   * **Les coordonnées du client n'y figurent que pendant la mission.** Une
   * fois la course terminée, le livreur garde l'historique mais plus le
   * numéro : Ojà reste l'intermédiaire unique, y compris après coup.
   */
  private toMissionView(shipment: {
    reference: string;
    status: ShipmentStatus;
    vehicle: string;
    distanceKm: number;
    pickupLine1: string;
    pickupLandmark: string | null;
    pickupLatitude: number | null;
    pickupLongitude: number | null;
    subOrder: {
      maker: { shopName: string };
      lines: { productName: string; quantity: number }[];
      balanceDueXof: number;
      cashCollectedAt: Date | null;
    };
    order: {
      reference: string;
      shipFullName: string;
      shipPhone: string;
      shipLine1: string;
      shipLandmark: string | null;
      shipLatitude: number | null;
      shipLongitude: number | null;
    };
  }) {
    const inProgress = ['TO_PICK_UP', 'PICKED_UP', 'IN_DELIVERY', 'RETURN_REQUIRED'].includes(
      shipment.status,
    );

    return {
      reference: shipment.reference,
      orderReference: shipment.order.reference,
      status: shipment.status,
      statusLabel: SHIPMENT_LABELS[shipment.status],
      vehicle: shipment.vehicle,
      distanceKm: shipment.distanceKm,

      pickup: {
        shopName: shipment.subOrder.maker.shopName,
        line1: shipment.pickupLine1,
        landmark: shipment.pickupLandmark,
        latitude: shipment.pickupLatitude,
        longitude: shipment.pickupLongitude,
      },

      drop: {
        fullName: shipment.order.shipFullName,
        // Le numéro du client n'est visible que le temps de la course.
        phone: inProgress ? shipment.order.shipPhone : null,
        line1: shipment.order.shipLine1,
        landmark: shipment.order.shipLandmark,
        latitude: inProgress ? shipment.order.shipLatitude : null,
        longitude: inProgress ? shipment.order.shipLongitude : null,
      },

      items: shipment.subOrder.lines,

      /* Ce que le livreur doit encaisser en remettant le colis (0 si tout a
         été payé en ligne, ou si c'est déjà fait). Il ne peut pas confirmer
         la remise sans l'avoir déclaré. */
      cashToCollectXof: shipment.subOrder.cashCollectedAt ? 0 : shipment.subOrder.balanceDueXof,
    };
  }

  async pickUp(userId: string, reference: string): Promise<{ status: string }> {
    const shipment = await this.requireOwnMission(userId, reference);
    assertShipmentTransition(shipment.status, 'PICKED_UP');

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: 'PICKED_UP', pickedUpAt: new Date() },
      });
      await tx.shipmentEvent.create({
        data: { shipmentId: shipment.id, status: 'PICKED_UP', actorId: userId },
      });
      await this.moveSubOrder(tx, shipment.subOrderId, 'IN_DELIVERY');
    });

    this.events.publish(reference, {
      status: 'PICKED_UP',
      note: 'Colis récupéré à l’atelier',
      at: new Date().toISOString(),
    });
    return { status: 'PICKED_UP' };
  }

  async startDelivery(
    userId: string,
    reference: string,
    position?: { latitude: number; longitude: number },
  ): Promise<{ status: string }> {
    const shipment = await this.requireOwnMission(userId, reference);
    assertShipmentTransition(shipment.status, 'IN_DELIVERY');

    await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: 'IN_DELIVERY' },
      }),
      this.prisma.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'IN_DELIVERY',
          actorId: userId,
          ...(position ?? {}),
        },
      }),
    ]);

    this.events.publish(reference, {
      status: 'IN_DELIVERY',
      note: 'Le livreur est en route',
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      at: new Date().toISOString(),
    });
    return { status: 'IN_DELIVERY' };
  }

  /**
   * Position du livreur pendant le trajet, pour le suivi du client (L4-15).
   *
   * Poussée toutes les 30 s par l'app livreur tant que la course est en cours.
   * Chaque point rejoint le flux SSE du client immédiatement ; il est aussi
   * conservé, mais on ne réécrit pas la table si le livreur n'a pas bougé —
   * inutile d'y accumuler des points identiques à l'arrêt.
   */
  async reportPosition(
    userId: string,
    reference: string,
    position: { latitude: number; longitude: number },
  ): Promise<void> {
    const shipment = await this.requireOwnMission(userId, reference);
    if (shipment.status !== 'IN_DELIVERY') return;

    const last = await this.prisma.shipmentEvent.findFirst({
      where: { shipmentId: shipment.id, status: 'IN_DELIVERY', latitude: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { latitude: true, longitude: true },
    });

    const movedMeters =
      last?.latitude != null && last.longitude != null
        ? haversineKm(
            { latitude: last.latitude, longitude: last.longitude },
            position,
          ) * 1000
        : Infinity;

    if (movedMeters >= 25) {
      await this.prisma.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'IN_DELIVERY',
          actorId: userId,
          latitude: position.latitude,
          longitude: position.longitude,
        },
      });
    }

    this.events.publish(reference, {
      status: 'IN_DELIVERY',
      latitude: position.latitude,
      longitude: position.longitude,
      at: new Date().toISOString(),
    });
  }

  /**
   * Suivi d'une livraison, côté client (cahier F1-07).
   *
   * La propriété est dans le WHERE : un client qui demande le suivi d'une
   * commande d'autrui reçoit 404, jamais 403.
   */
  async trackFor(reference: string, userId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { reference, order: { customerId: userId } },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        order: { select: { shipLine1: true } },
      },
    });
    if (!shipment) throw new NotFoundException();

    const withPosition = [...shipment.events]
      .reverse()
      .find((event) => event.latitude !== null && event.longitude !== null);

    return {
      reference: shipment.reference,
      status: shipment.status,
      statusLabel: SHIPMENT_LABELS[shipment.status],
      etaAt: shipment.etaAt?.toISOString() ?? null,
      lastPosition:
        withPosition && withPosition.latitude !== null && withPosition.longitude !== null
          ? {
              latitude: withPosition.latitude,
              longitude: withPosition.longitude,
              at: withPosition.createdAt.toISOString(),
            }
          : null,
      events: shipment.events.map((event) => ({
        status: event.status,
        statusLabel: SHIPMENT_LABELS[event.status],
        note: event.note,
        latitude: event.latitude,
        longitude: event.longitude,
        at: event.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Remise au client, avec preuve.
   *
   * Sans preuve valide, la remise est refusée : le compte à rebours de
   * validation ne démarre pas, donc l'atelier n'est pas payé. C'est le verrou
   * de tout le circuit financier.
   */
  async deliver(
    userId: string,
    reference: string,
    submission: ProofSubmission,
    cashCollectedXof?: number,
  ): Promise<{ status: string; provided: string[] }> {
    const shipment = await this.requireOwnMission(userId, reference);
    assertShipmentTransition(shipment.status, 'DELIVERED');

    /* Paiement à la livraison ou solde d'un acompte : le livreur ne peut pas
       clore la remise sans déclarer avoir encaissé **exactement** la part due.
       Un montant inférieur laisserait un trou dans la caisse que personne ne
       verrait avant le reversement ; refuser tout de suite le rend visible
       au moment où le client est encore là. */
    const toCollect = await this.prisma.subOrder.findUniqueOrThrow({
      where: { id: shipment.subOrderId },
      select: { reference: true, balanceDueXof: true, cashCollectedAt: true },
    });
    const cashDue = toCollect.cashCollectedAt ? 0 : toCollect.balanceDueXof;
    if (cashDue > 0 && cashCollectedXof !== cashDue) {
      throw new BadRequestException({
        error: 'Encaissement requis',
        message: `Encaissez ${cashDue} F CFA auprès du client avant de confirmer la remise.`,
        errors: [
          {
            field: 'cashCollectedXof',
            message:
              cashCollectedXof === undefined
                ? `Montant à encaisser : ${cashDue} F CFA.`
                : `Montant attendu : ${cashDue} F CFA (reçu ${cashCollectedXof}).`,
          },
        ],
      });
    }

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: shipment.orderId },
    });

    const destination =
      order.shipLatitude !== null && order.shipLongitude !== null
        ? { latitude: order.shipLatitude, longitude: order.shipLongitude }
        : undefined;

    const assessment = assessProof(submission, {
      expectedOtp: shipment.proofOtp ?? '',
      destination,
      distanceMeters: destination
        ? (point) => haversineKm(destination, point) * 1000
        : undefined,
    });

    if (!assessment.accepted) {
      throw new BadRequestException({
        error: 'Preuve insuffisante',
        message: 'Deux éléments de preuve sont nécessaires pour valider la remise.',
        errors: assessment.problems.map((message) => ({ field: 'proof', message })),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          proofAt: new Date(),
          ...(submission.photoKey ? { proofPhotoKey: submission.photoKey } : {}),
          ...(submission.latitude !== undefined ? { proofLatitude: submission.latitude } : {}),
          ...(submission.longitude !== undefined ? { proofLongitude: submission.longitude } : {}),
        },
      });

      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'DELIVERED',
          actorId: userId,
          note: `Preuve : ${assessment.provided.join(', ')}`,
        },
      });

      await this.moveSubOrder(tx, shipment.subOrderId, 'DELIVERED');

      if (cashDue > 0) {
        await tx.subOrder.update({
          where: { id: shipment.subOrderId },
          data: { cashCollectedAt: new Date(), cashCollectedXof: cashDue },
        });
        // Les espèces sont chez le livreur, pas encore chez Ojà : le grand
        // livre garde la trace de ce qu'il doit reverser.
        await this.ledger.recordCashCollected(tx, {
          subOrderId: shipment.subOrderId,
          subOrderReference: toCollect.reference,
          courierUserId: userId,
          amountXof: cashDue,
        });
      }
    });

    this.events.publish(reference, {
      status: 'DELIVERED',
      note: 'Colis remis au client',
      at: new Date().toISOString(),
    });

    /* Le client a 72 h pour valider. C'est le message le plus important du
       parcours : sans lui, il ignore qu'un geste lui est demandé et chaque
       commande attend la validation automatique. */
    await this.notifications.subOrderDelivered(shipment.subOrderId);

    this.logger.log(`${reference} livrée (preuve : ${assessment.provided.join(', ')})`);
    return { status: 'DELIVERED', provided: assessment.provided };
  }

  async setAvailability(userId: string, isAvailable: boolean): Promise<{ isAvailable: boolean }> {
    const courier = await this.requireCourier(userId);
    const updated = await this.prisma.courierProfile.update({
      where: { id: courier.id },
      data: { isAvailable },
    });
    return { isAvailable: updated.isAvailable };
  }

  // ═══════════════════════════════ Utilitaires

  private async moveSubOrder(
    tx: Prisma.TransactionClient,
    subOrderId: string,
    status: 'IN_DELIVERY' | 'DELIVERED',
  ): Promise<void> {
    const subOrder = await tx.subOrder.findUniqueOrThrow({ where: { id: subOrderId } });
    assertSubOrderTransition(subOrder.status, status);

    await tx.subOrder.update({
      where: { id: subOrderId },
      data: { status, ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}) },
    });

    const [statuses, paid] = await Promise.all([
      tx.subOrder.findMany({ where: { orderId: subOrder.orderId }, select: { status: true } }),
      tx.order.findFirst({
        where: { id: subOrder.orderId, placedAt: { not: null } },
        select: { id: true },
      }),
    ]);

    const next = deriveOrderStatus(
      statuses.map((s) => s.status),
      paid !== null,
    );

    await tx.order.update({
      where: { id: subOrder.orderId },
      data: {
        status: next,
        ...(next === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      },
    });
  }

  /**
   * Distance de la course, calculée **comme au chiffrage** : point précis,
   * sinon centre de la ville, et le même facteur de sinuosité. Calculée
   * autrement, l'expédition affichait 0 km pour une livraison facturée sur
   * 4,1 km dès qu'une adresse n'avait pas de coordonnées.
   */
  private distanceFor(
    maker: {
      pickupLatitude: number | null;
      pickupLongitude: number | null;
      city: { latitude: number | null; longitude: number | null };
    },
    order: { shipLatitude: number | null; shipLongitude: number | null },
    shipCity: { latitude: number | null; longitude: number | null },
  ): number {
    const from = pointOf(maker.pickupLatitude, maker.pickupLongitude, maker.city);
    const to = pointOf(order.shipLatitude, order.shipLongitude, shipCity);
    // Le chiffrage refuse une commande sans position : ce cas n'arrive pas.
    if (!from || !to) return 0;
    return Math.round(billableDistanceKm(from, to, this.sinuosityFactor) * 10) / 10;
  }

  private async vehicleFor(
    tx: Prisma.TransactionClient,
    cityId: string,
    load: { weightGrams: number; volumeL: number },
  ) {
    const city = await tx.city.findUniqueOrThrow({ where: { id: cityId } });
    const rates = await tx.vehicleRate.findMany({
      where: { countryId: city.countryId, isActive: true },
      orderBy: { maxWeightKg: 'asc' },
    });

    const fitting = rates.find(
      (rate) => load.weightGrams <= rate.maxWeightKg * 1000 && load.volumeL <= rate.maxVolumeL,
    );
    return fitting?.vehicle ?? rates[rates.length - 1]?.vehicle ?? 'CAMIONNETTE';
  }

  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const counter = await tx.referenceCounter.upsert({
      where: { scope_year: { scope: 'shipment', year } },
      update: { value: { increment: 1 } },
      create: { scope: 'shipment', year, value: 1 },
    });
    return `LIV-${year}-${String(counter.value).padStart(6, '0')}`;
  }

  private async requireCourier(userId: string) {
    const courier = await this.prisma.courierProfile.findUnique({ where: { userId } });
    if (!courier) throw new NotFoundException('Aucun profil livreur pour ce compte.');
    return courier;
  }

  /** Un livreur qui vise la mission d'un autre reçoit 404, jamais 403. */
  private async requireOwnMission(userId: string, reference: string) {
    const courier = await this.requireCourier(userId);
    const shipment = await this.prisma.shipment.findFirst({
      where: { reference, courierId: courier.id },
    });
    if (!shipment) throw new NotFoundException();
    return shipment;
  }
}

/** Ordre de capacité : un véhicule plus grand convient toujours. */
function capacityRank(vehicle: string): number {
  return { MOTO: 1, TRICYCLE: 2, CAMIONNETTE: 3 }[vehicle] ?? 0;
}
