import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CheckoutQuote, DeliveryQuoteLine } from '@oja/contracts';
import {
  billableDistanceKm,
  DeliveryError,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
  quoteDelivery,
  splitPayment,
  type ParcelItem,
  type VehicleRate,
} from '@oja/domain';

import { CartService, toClientCart, type PricedCart } from '../cart/cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from './promo.service';

/**
 * Chiffrage d'un panier prêt à être commandé.
 *
 * Décision produit : **une livraison par atelier**. Chaque groupe du panier
 * donne lieu à son propre trajet, son propre véhicule et ses propres frais.
 * Le client les voit ligne par ligne avant de payer.
 */
@Injectable()
export class QuoteService {
  private readonly sinuosityFactor: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly promos: PromoService,
    config: ConfigService,
  ) {
    this.sinuosityFactor = config.get<number>('DISTANCE_SINUOSITY_FACTOR', 1.3);
  }

  async quote(
    cartId: string,
    userId: string,
    addressId: string,
    promoCode?: string,
  ): Promise<CheckoutQuote> {
    /* L'autorisation d'abord, la validation métier ensuite.
     *
     * Vérifier le panier avant l'adresse laisserait un panier vide masquer le
     * contrôle d'accès : quelqu'un qui sonde l'adresse d'un autre recevrait
     * « votre panier est vide » au lieu d'un 404, et apprendrait au passage
     * que la route ne l'a pas rejeté. Le droit sur la ressource se tranche en
     * premier, toujours. */
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
      include: { city: { include: { country: true } } },
    });
    if (!address) throw new NotFoundException('Adresse de livraison introuvable.');

    const cart = await this.carts.pricedView(cartId);
    const blockers: string[] = [];

    if (cart.groups.length === 0) {
      throw new BadRequestException('Votre panier est vide.');
    }

    if (!address.city.country.isActive) {
      blockers.push("Ojà ne livre pas encore dans ce pays.");
    }

    // Les lignes en rupture ou retirées de la vente remontent telles quelles :
    // le client les corrige au panier, pas au moment de payer.
    for (const group of cart.groups) {
      for (const line of group.lines) {
        if (line.issue) blockers.push(`${line.name} — ${line.issue}`);
      }
    }

    const rates = await this.ratesFor(address.city.countryId);
    if (rates.length === 0) {
      blockers.push('Aucun moyen de livraison configuré pour ce pays.');
    }

    const deliveries: DeliveryQuoteLine[] = [];

    for (const group of cart.groups) {
      const delivery = await this.quoteOneDelivery(group, address, rates, blockers);
      if (delivery) deliveries.push(delivery);
    }

    const deliveryTotalXof = deliveries.reduce((total, d) => total + d.feeXof, 0);

    /* La TVA reste à zéro tant que la décision fiscale n'est pas prise
       (SPEC-ALIGNEMENT § 5). Le calcul est en place : activer `vatBps` sur le
       pays suffit à la faire apparaître, sans toucher au code. */
    const vatBps = address.city.country.vatBps;
    const vatXof = Math.floor(((cart.itemsFinalTotalXof + deliveryTotalXof) * vatBps) / 10_000);

    /* Code promo : la remise porte sur les articles et la livraison (hors TVA)
       et ne descend jamais sous la commission Ojà. Un code refusé n'est pas
       une erreur bloquante en soi — il rejoint la liste des points à corriger,
       comme une rupture de stock. */
    let discountXof = 0;
    let promo: CheckoutQuote['promo'] = null;
    if (promoCode) {
      try {
        const evaluation = await this.promos.evaluate(
          this.prisma,
          promoCode,
          userId,
          cart.itemsFinalTotalXof + deliveryTotalXof,
          cart.commissionTotalXof,
        );
        discountXof = evaluation.discountXof;
        promo = { code: evaluation.code, label: evaluation.label };
      } catch (error) {
        blockers.push(
          error instanceof Error ? error.message : `Code promo « ${promoCode} » refusé.`,
        );
      }
    }

    const totalXof = Math.max(0, cart.itemsFinalTotalXof + deliveryTotalXof + vatXof - discountXof);

    return {
      // Le client ne reçoit que la vue publique : ni part créateur, ni marge Ojà.
      cart: toClientCart(cart),
      deliveries,
      itemsFinalTotalXof: cart.itemsFinalTotalXof,
      deliveryTotalXof,
      vatXof,
      discountXof,
      promo,
      totalXof,
      paymentOptions:
        totalXof > 0
          ? PAYMENT_MODES.map((mode) => ({
              mode,
              label: PAYMENT_MODE_LABELS[mode],
              ...splitPayment(totalXof, mode),
            }))
          : [],
      blockers,
    };
  }

  private async quoteOneDelivery(
    group: PricedCart['groups'][number],
    address: {
      latitude: number | null;
      longitude: number | null;
      city: { latitude: number | null; longitude: number | null; name: string };
    },
    rates: VehicleRate[],
    blockers: string[],
  ): Promise<DeliveryQuoteLine | null> {
    const maker = await this.prisma.makerProfile.findUnique({
      where: { id: group.makerId },
      include: { city: true },
    });
    if (!maker) return null;

    const from = pointOf(maker.pickupLatitude, maker.pickupLongitude, maker.city);
    const to = pointOf(address.latitude, address.longitude, address.city);

    if (!from || !to) {
      // Sans position, aucun tarif honnête n'est calculable. On le dit plutôt
      // que d'inventer un forfait.
      blockers.push(
        !from
          ? `${group.shopName} n'a pas indiqué la position de son atelier.`
          : 'Précisez la position de votre adresse de livraison.',
      );
      return null;
    }

    const distanceKm = billableDistanceKm(from, to, this.sinuosityFactor);
    const parcels = await this.parcelsFor(group);

    try {
      const delivery = quoteDelivery(parcels, distanceKm, rates);

      return {
        makerId: group.makerId,
        shopName: group.shopName,
        vehicle: delivery.vehicle,
        distanceKm: Math.round(distanceKm * 10) / 10,
        feeXof: delivery.feeXof,
        ...this.etaFor(group, distanceKm),
      };
    } catch (error) {
      if (error instanceof DeliveryError) {
        blockers.push(`${group.shopName} — ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  private async parcelsFor(group: PricedCart['groups'][number]): Promise<ParcelItem[]> {
    const products = await this.prisma.product.findMany({
      where: { id: { in: group.lines.map((line) => line.productId) } },
      select: {
        id: true,
        weightGrams: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    return group.lines.flatMap((line) => {
      const product = byId.get(line.productId);
      if (!product) return [];
      return [
        {
          weightGrams: product.weightGrams,
          lengthMm: product.lengthMm,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          quantity: line.quantity,
        },
      ];
    });
  }

  /**
   * Délai annoncé : la fabrication la plus longue du groupe, plus le trajet.
   *
   * C'est le maximum et non la somme — les pièces d'un même atelier se
   * fabriquent en parallèle, et de toute façon elles partent ensemble.
   */
  private etaFor(
    group: PricedCart['groups'][number],
    distanceKm: number,
  ): { etaMinDays: number; etaMaxDays: number } {
    const production = Math.max(
      0,
      ...group.lines.map((line) => (line.isMadeToOrder ? (line.leadTimeDays ?? 0) : 0)),
    );
    const transit = distanceKm <= 30 ? 1 : distanceKm <= 200 ? 2 : 4;

    return {
      etaMinDays: production + transit,
      // Une fourchette plutôt qu'une date : promettre un jour précis sur une
      // pièce faite main, c'est promettre un litige.
      etaMaxDays: production + transit + 2,
    };
  }

  private async ratesFor(countryId: string): Promise<VehicleRate[]> {
    const rates = await this.prisma.vehicleRate.findMany({
      where: { countryId, isActive: true },
    });

    return rates.map((rate) => ({
      vehicle: rate.vehicle,
      baseFeeXof: rate.baseFeeXof,
      perKmXof: rate.perKmXof,
      minFeeXof: rate.minFeeXof,
      maxWeightKg: rate.maxWeightKg,
      maxVolumeL: rate.maxVolumeL,
      maxLengthCm: rate.maxLengthCm,
    }));
  }
}

/**
 * Position à utiliser : le point précis s'il existe, le centre de la ville
 * sinon. Le repli sur la ville donne un tarif approximatif mais plausible,
 * là où l'absence de position rendrait toute commande impossible.
 */
export function pointOf(
  latitude: number | null,
  longitude: number | null,
  city: { latitude: number | null; longitude: number | null },
): { latitude: number; longitude: number } | null {
  if (latitude !== null && longitude !== null) return { latitude, longitude };
  if (city.latitude !== null && city.longitude !== null) {
    return { latitude: city.latitude, longitude: city.longitude };
  }
  return null;
}
