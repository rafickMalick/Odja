import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderView } from '@oja/contracts';
import { ORDER_LABELS, SUB_ORDER_LABELS, subOrderRespondByAt } from '@oja/domain';
import type { Prisma } from '@oja/db';

import { CartService } from '../cart/cart.service';
import { cursorArgs, toPage, type CursorQuery, type Page } from '../common/pagination';
import { PaymentService } from '../payments/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from './promo.service';
import { QuoteService } from './quote.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly acceptHours: number;
  private readonly paymentExpiryMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly quotes: QuoteService,
    private readonly promos: PromoService,
    private readonly payments: PaymentService,
    config: ConfigService,
  ) {
    this.acceptHours = config.get<number>('SUBORDER_ACCEPT_HOURS', 48);
    this.paymentExpiryMinutes = config.get<number>('PAYMENT_EXPIRY_MINUTES', 30);
  }

  /**
   * Transforme un panier en commande.
   *
   * Trois principes tiennent cette méthode :
   *
   *   · **le montant n'est jamais celui du navigateur.** Le client transmet le
   *     total qu'on lui a affiché, et on refuse s'il ne correspond plus au
   *     total recalculé. Il ne le fixe pas, il le confirme ;
   *
   *   · **un atelier, une sous-commande, une livraison.** Chaque groupe du
   *     panier devient une unité que le créateur voit, accepte et prépare, et
   *     sur laquelle porte son versement ;
   *
   *   · **tout est figé par copie.** Nom, prix, taux de commission, adresse :
   *     un créateur qui change ses prix demain ne réécrit pas l'histoire d'une
   *     commande passée aujourd'hui.
   */
  async placeOrder(
    userId: string,
    cartId: string,
    addressId: string,
    expectedTotalXof: number,
    promoCode?: string,
  ): Promise<OrderView> {
    const quote = await this.quotes.quote(cartId, userId, addressId, promoCode);

    /* Le chiffrage ne renvoie plus la part créateur ni la commission — le
       client ne doit pas les voir. On récupère donc le détail des prix par la
       vue interne du panier, uniquement côté serveur, pour éclater la commande
       en sous-commandes et figer les montants. */
    const pricedCart = await this.carts.pricedView(cartId);

    if (quote.blockers.length > 0) {
      throw new BadRequestException({
        error: 'Commande impossible',
        message: 'Votre panier doit être corrigé avant de commander.',
        errors: quote.blockers.map((message) => ({ field: 'cart', message })),
      });
    }

    /* Le total a pu bouger entre l'affichage et le clic : un prix modifié par
       l'atelier, un stock parti. On refuse plutôt que de débiter un montant
       que le client n'a pas vu. */
    if (quote.totalXof !== expectedTotalXof) {
      throw new ConflictException(
        `Le total a changé depuis l'affichage (${expectedTotalXof} → ${quote.totalXof} F CFA). ` +
          'Vérifiez votre panier avant de confirmer.',
      );
    }

    const address = await this.prisma.address.findFirstOrThrow({
      where: { id: addressId, userId, deletedAt: null },
    });

    const deliveryByMaker = new Map(quote.deliveries.map((d) => [d.makerId, d]));
    const now = new Date();

    const order = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx, 'order', 'CMD');

      /* Le code promo est réévalué **ici**, dans la transaction : il a pu
         s'épuiser entre l'affichage du panier et le clic. L'incrément du
         compteur est gardé par le WHERE — deux commandes simultanées sur la
         dernière utilisation ne passent pas toutes les deux. */
      let discountXof = 0;
      let promoCodeId: string | null = null;
      if (promoCode && quote.promo) {
        const evaluation = await this.promos.evaluate(
          tx,
          promoCode,
          userId,
          quote.itemsFinalTotalXof + quote.deliveryTotalXof,
          pricedCart.commissionTotalXof,
        );
        const redeemed = await tx.promoCode.updateMany({
          where: {
            id: evaluation.promoCodeId,
            ...(evaluation.maxRedemptions !== null
              ? { redemptionCount: { lt: evaluation.maxRedemptions } }
              : {}),
          },
          data: { redemptionCount: { increment: 1 } },
        });
        if (redeemed.count === 0) {
          throw new ConflictException("Ce code promo vient d'atteindre sa limite d'utilisation.");
        }
        discountXof = evaluation.discountXof;
        promoCodeId = evaluation.promoCodeId;
      }

      const created = await tx.order.create({
        data: {
          reference,
          customerId: userId,
          status: 'PENDING_PAYMENT',

          // Adresse figée : le carnet du client peut changer, pas la commande.
          shipFullName: address.fullName,
          shipPhone: address.phone,
          shipCityId: address.cityId,
          shipLine1: address.line1,
          shipLandmark: address.landmark,
          shipLatitude: address.latitude,
          shipLongitude: address.longitude,

          itemsMakerTotalXof: pricedCart.itemsMakerTotalXof,
          commissionTotalXof: pricedCart.commissionTotalXof,
          itemsFinalTotalXof: quote.itemsFinalTotalXof,
          deliveryTotalXof: quote.deliveryTotalXof,
          vatXof: quote.vatXof,
          discountXof,
          promoCodeId,
          totalXof: quote.totalXof,
        },
      });

      if (promoCodeId) {
        await tx.promoRedemption.create({
          data: { promoCodeId, userId, orderId: created.id, amountXof: discountXof },
        });
      }

      for (const [index, group] of pricedCart.groups.entries()) {
        const delivery = deliveryByMaker.get(group.makerId);
        // Suffixe A, B, C… : lisible au téléphone, ce qui compte au support.
        const suffix = String.fromCharCode(65 + index);

        const subOrder = await tx.subOrder.create({
          data: {
            reference: `${reference}-${suffix}`,
            orderId: created.id,
            makerId: group.makerId,
            status: 'RECEIVED',
            itemsMakerSubtotalXof: group.itemsMakerSubtotalXof,
            commissionSubtotalXof: group.commissionSubtotalXof,
            deliveryFeeXof: delivery?.feeXof ?? 0,
            respondByAt: subOrderRespondByAt(now, this.acceptHours),
          },
        });

        for (const line of group.lines) {
          await tx.orderLine.create({
            data: {
              subOrderId: subOrder.id,
              productId: line.productId,
              productName: line.name,
              quantity: line.quantity,
              makerPriceXof: line.makerPriceXof,
              commissionBps: bpsOf(line.makerPriceXof, line.commissionXof),
              commissionXof: line.commissionXof,
              finalPriceXof: line.finalPriceXof,
              lineTotalXof: line.lineTotalXof,
            },
          });

          /* Réservation du stock **dès la création**, avant tout paiement.
             Sinon deux clients paient la même pièce unique, et l'un des deux
             sera remboursé — ce qui coûte les frais d'agrégateur, non
             récupérables. La réservation est relâchée si le paiement expire. */
          if (!line.isMadeToOrder) {
            const { count } = await tx.product.updateMany({
              where: {
                id: line.productId,
                // Condition dans le WHERE, pas dans le code : deux commandes
                // simultanées ne peuvent pas passer toutes les deux.
                quantityAvailable: { gte: line.quantity },
              },
              data: { quantityReserved: { increment: line.quantity } },
            });

            if (count === 0) {
              throw new ConflictException(
                `« ${line.name} » vient d'être commandée par quelqu'un d'autre.`,
              );
            }
          }
        }
      }

      const payment = await tx.payment.create({
        data: {
          orderId: created.id,
          status: 'INITIATED',
          channel: 'MOBILE_MONEY',
          // Le vrai nom est posé par `initiateCheckout`, une fois le
          // fournisseur effectivement consulté — hors transaction, voir
          // plus bas.
          provider: 'pending',
          amountXof: quote.totalXof,
          idempotencyKey: `${created.id}:initial`,
          expiresAt: new Date(now.getTime() + this.paymentExpiryMinutes * 60_000),
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId } });

      return { orderId: created.id, paymentId: payment.id };
    });

    /* L'amorce auprès du fournisseur se fait **hors transaction** : c'est un
       appel externe (ou, pour Kadev Pay, une préparation locale sans réseau),
       et une transaction PostgreSQL ne doit jamais rester ouverte en
       attendant un tiers. Un échec ici ne défait pas la commande : elle
       existe, en attente de paiement, et peut être reprise. */
    const customer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const checkout = await this.payments.initiateCheckout(order.paymentId, {
      fullName: address.fullName,
      email: customer.email,
      phone: address.phone,
    });

    this.logger.log(`Commande ${order.orderId} créée (${pricedCart.groups.length} atelier(s))`);
    const view = await this.byId(order.orderId, userId);
    return { ...view, checkout };
  }

  async listMine(userId: string, query: CursorQuery): Promise<Page<OrderView>> {
    const orders = await this.prisma.order.findMany({
      where: { customerId: userId },
      include: FULL_ORDER,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(query),
    });
    const page = toPage(orders, query.limit);
    return { nextCursor: page.nextCursor, items: page.items.map(toOrderView) };
  }

  async byReference(reference: string, userId: string): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      // La contrainte de propriété est dans le WHERE : un client qui demande
      // la commande d'un autre reçoit 404, pas 403.
      where: { reference, customerId: userId },
      include: FULL_ORDER,
    });
    if (!order) throw new NotFoundException();
    return toOrderView(order);
  }

  /**
   * Vérification active à l'ouverture de la page de confirmation.
   *
   * L'agrégateur redirige souvent le navigateur plus vite qu'il n'envoie son
   * webhook : sans ce contrôle, un client qui vient de payer verrait
   * « en attente » pendant de longues secondes. La propriété est vérifiée
   * avant toute chose, comme partout ailleurs — un 404 sur une commande
   * d'autrui, jamais un 403.
   */
  async verifyPayment(reference: string, userId: string, providerRef?: string): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      where: { reference, customerId: userId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException();

    await this.payments.verifyPending(reference, providerRef);
    return this.byId(order.id, userId);
  }

  private async byId(id: string, userId: string): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      include: FULL_ORDER,
    });
    if (!order) throw new NotFoundException();
    return toOrderView(order);
  }

  /**
   * Référence lisible et **sans trou** : CMD-2026-000123.
   *
   * Un compteur en table plutôt qu'une séquence Postgres : une séquence
   * consomme son numéro même quand la transaction est annulée, ce qui laisse
   * des trous. Une numérotation comptable ne peut pas en avoir.
   */
  private async nextReference(
    tx: Prisma.TransactionClient,
    scope: string,
    prefix: string,
  ): Promise<string> {
    const year = new Date().getFullYear();

    const counter = await tx.referenceCounter.upsert({
      where: { scope_year: { scope, year } },
      update: { value: { increment: 1 } },
      create: { scope, year, value: 1 },
    });

    return `${prefix}-${year}-${String(counter.value).padStart(6, '0')}`;
  }
}

const FULL_ORDER = {
  subOrders: {
    include: { lines: true, maker: { select: { shopName: true } }, shipment: true },
    orderBy: { reference: 'asc' as const },
  },
  promoCode: { select: { code: true } },
  invoice: { select: { id: true } },
};

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof FULL_ORDER }>;

function toOrderView(order: OrderWithRelations): OrderView {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    statusLabel: ORDER_LABELS[order.status],

    shipFullName: order.shipFullName,
    shipPhone: order.shipPhone,
    shipLine1: order.shipLine1,
    shipLandmark: order.shipLandmark,

    subOrders: order.subOrders.map((subOrder) => ({
      reference: subOrder.reference,
      shopName: subOrder.maker.shopName,
      status: subOrder.status,
      statusLabel: SUB_ORDER_LABELS[subOrder.status],
      lines: subOrder.lines.map((line) => ({
        productName: line.productName,
        quantity: line.quantity,
        // Le client ne voit que le prix qu'il a payé, commission comprise.
        finalPriceXof: line.finalPriceXof,
        lineTotalXof: line.lineTotalXof,
      })),
      deliveryFeeXof: subOrder.deliveryFeeXof,
      vehicle: subOrder.shipment?.vehicle ?? null,
      dueReadyAt: subOrder.dueReadyAt?.toISOString() ?? null,
      shipmentReference: subOrder.shipment?.reference ?? null,
    })),

    itemsFinalTotalXof: order.itemsFinalTotalXof,
    deliveryTotalXof: order.deliveryTotalXof,
    vatXof: order.vatXof,
    discountXof: order.discountXof,
    promoCode: order.promoCode?.code ?? null,
    totalXof: order.totalXof,

    placedAt: order.placedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    hasInvoice: order.invoice !== null,
  };
}

/** Retrouve le taux appliqué, pour le figer sur la ligne de commande. */
function bpsOf(makerPriceXof: number, commissionXof: number): number {
  if (makerPriceXof === 0) return 0;
  return Math.round((commissionXof * 10_000) / makerPriceXof);
}
