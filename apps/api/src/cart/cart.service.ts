import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CartLine, CartMakerGroup, CartView } from '@oja/contracts';
import { commissionFor } from '@oja/domain';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Un panier abandonné n'a pas vocation à réserver de la place indéfiniment. */
const CART_TTL_DAYS = 30;

/**
 * Vue interne du panier, avec le détail des prix.
 *
 * Elle porte, en plus de ce que voit le client, la part créateur et la
 * commission Ojà — nécessaires pour éclater la commande en sous-commandes et
 * plafonner un code promo. **Elle ne sort jamais d'un contrôleur** : `view()`
 * en dérive la vue publique, sans ces champs.
 */
export interface PricedCartLine extends CartLine {
  makerPriceXof: number;
  commissionXof: number;
}
export interface PricedCartGroup extends Omit<CartMakerGroup, 'lines'> {
  lines: PricedCartLine[];
  itemsMakerSubtotalXof: number;
  commissionSubtotalXof: number;
}
export interface PricedCart extends Omit<CartView, 'groups'> {
  groups: PricedCartGroup[];
  itemsMakerTotalXof: number;
  commissionTotalXof: number;
}

@Injectable()
export class CartService {
  private readonly defaultCommissionBps: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.defaultCommissionBps = config.get<number>('PLATFORM_COMMISSION_BPS', 500);
  }

  /**
   * Retrouve ou crée le panier courant.
   *
   * Un visiteur non connecté a droit à un panier : lui demander de créer un
   * compte avant d'avoir choisi quoi que ce soit est le meilleur moyen de le
   * perdre. Le panier vit alors sur un jeton de cookie, et sera fusionné à la
   * connexion.
   */
  async resolve(userId: string | null, token: string | null): Promise<{ id: string; token: string }> {
    if (userId) {
      const existing = await this.prisma.cart.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (existing) return { id: existing.id, token: existing.token };

      const created = await this.prisma.cart.create({
        data: { userId, token: newToken(), expiresAt: expiry() },
      });
      return { id: created.id, token: created.token };
    }

    if (token) {
      const existing = await this.prisma.cart.findUnique({ where: { token } });
      if (existing && existing.expiresAt > new Date()) {
        return { id: existing.id, token: existing.token };
      }
    }

    const created = await this.prisma.cart.create({
      data: { token: newToken(), expiresAt: expiry() },
    });
    return { id: created.id, token: created.token };
  }

  /**
   * Fusionne le panier anonyme dans celui de l'utilisateur à la connexion.
   *
   * Les quantités s'**additionnent** plutôt que de s'écraser : quelqu'un qui a
   * mis deux tabourets avant de se connecter, et en avait déjà un enregistré,
   * en veut vraisemblablement trois. Écraser ferait disparaître un choix qu'il
   * a fait explicitement.
   */
  async merge(userId: string, anonymousToken: string): Promise<void> {
    const anonymous = await this.prisma.cart.findUnique({
      where: { token: anonymousToken },
      include: { items: true },
    });
    if (!anonymous || anonymous.userId || anonymous.items.length === 0) return;

    const { id: targetId } = await this.resolve(userId, null);
    if (targetId === anonymous.id) return;

    await this.prisma.$transaction(async (tx) => {
      for (const item of anonymous.items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_productId: { cartId: targetId, productId: item.productId } },
        });

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: Math.min(existing.quantity + item.quantity, 99) },
          });
        } else {
          await tx.cartItem.create({
            data: { cartId: targetId, productId: item.productId, quantity: item.quantity },
          });
        }
      }
      await tx.cart.delete({ where: { id: anonymous.id } });
    });
  }

  async addItem(cartId: string, productId: string, quantity: number): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'PUBLISHED', hiddenAt: null, deletedAt: null },
    });
    // Une pièce non publiée ne se met pas au panier — et on ne dit pas si elle
    // existe ailleurs dans le catalogue.
    if (!product) throw new NotFoundException();

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } },
    });

    const wanted = Math.min((existing?.quantity ?? 0) + quantity, 99);

    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      update: { quantity: wanted },
      create: { cartId, productId, quantity: wanted },
    });

    await this.touch(cartId);
  }

  async setQuantity(cartId: string, itemId: string, quantity: number): Promise<void> {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) throw new NotFoundException();

    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    await this.touch(cartId);
  }

  async removeItem(cartId: string, itemId: string): Promise<void> {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    if (count === 0) throw new NotFoundException();
    await this.touch(cartId);
  }

  async clear(cartId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
    await this.touch(cartId);
  }

  /**
   * Compose la vue du panier, **groupée par atelier**.
   *
   * Ce regroupement n'est pas un choix d'affichage : chaque groupe deviendra
   * une sous-commande, avec sa propre livraison et son propre versement. Le
   * client doit le voir dès le panier.
   */
  async view(cartId: string): Promise<CartView> {
    return toClientCart(await this.pricedView(cartId));
  }

  /**
   * Vue **interne** avec le détail des prix (part créateur, commission).
   *
   * Réservée aux services — chiffrage et création de commande. Ne jamais la
   * renvoyer telle quelle au client.
   */
  async pricedView(cartId: string): Promise<PricedCart> {
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      include: {
        product: {
          include: {
            images: { orderBy: { position: 'asc' }, take: 1 },
            maker: { include: { city: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const groups = new Map<string, PricedCartGroup>();

    for (const item of items) {
      const product = item.product;
      const maker = product.maker;

      const commissionBps = maker.commissionBps || this.defaultCommissionBps;
      const commissionXof = commissionFor(product.makerPriceXof, commissionBps);
      const finalPriceXof = product.makerPriceXof + commissionXof;
      const available = product.quantityAvailable - product.quantityReserved;

      const line: PricedCartLine = {
        id: item.id,
        productId: product.id,
        slug: product.slug,
        name: product.name,
        imageUrl: product.images[0]
          ? this.storage.publicUrlFor(product.images[0].fileKey)
          : null,
        quantity: item.quantity,
        makerPriceXof: product.makerPriceXof,
        commissionXof,
        finalPriceXof,
        lineTotalXof: finalPriceXof * item.quantity,
        available: product.isMadeToOrder ? item.quantity : available,
        isMadeToOrder: product.isMadeToOrder,
        leadTimeDays: product.leadTimeDays,
        issue: describeIssue(product, item.quantity, available),
      };

      const group = groups.get(maker.id) ?? {
        makerId: maker.id,
        makerSlug: maker.slug,
        shopName: maker.shopName,
        city: maker.city.name,
        lines: [],
        itemsMakerSubtotalXof: 0,
        commissionSubtotalXof: 0,
        itemsFinalSubtotalXof: 0,
      };

      group.lines.push(line);
      group.itemsMakerSubtotalXof += product.makerPriceXof * item.quantity;
      group.commissionSubtotalXof += commissionXof * item.quantity;
      group.itemsFinalSubtotalXof += line.lineTotalXof;
      groups.set(maker.id, group);
    }

    const list = [...groups.values()];

    return {
      id: cartId,
      groups: list,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      itemsMakerTotalXof: sum(list, (g) => g.itemsMakerSubtotalXof),
      commissionTotalXof: sum(list, (g) => g.commissionSubtotalXof),
      itemsFinalTotalXof: sum(list, (g) => g.itemsFinalSubtotalXof),
      hasIssues: list.some((g) => g.lines.some((l) => l.issue !== null)),
    };
  }

  async requireOwnCart(cartId: string, userId: string | null, token: string | null): Promise<void> {
    const cart = await this.prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new NotFoundException();

    const owned = cart.userId ? cart.userId === userId : cart.token === token;
    if (!owned) throw new NotFoundException();
  }

  private async touch(cartId: string): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { expiresAt: expiry() },
    });
  }
}

/**
 * Retire du panier interne tout ce qui n'a pas à parvenir au client : la part
 * créateur et la commission Ojà, ligne par ligne et en totaux. Le client ne
 * voit que le prix qu'il paie.
 */
export function toClientCart(priced: PricedCart): CartView {
  return {
    id: priced.id,
    itemCount: priced.itemCount,
    itemsFinalTotalXof: priced.itemsFinalTotalXof,
    hasIssues: priced.hasIssues,
    groups: priced.groups.map((group) => ({
      makerId: group.makerId,
      makerSlug: group.makerSlug,
      shopName: group.shopName,
      city: group.city,
      itemsFinalSubtotalXof: group.itemsFinalSubtotalXof,
      lines: group.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        slug: line.slug,
        name: line.name,
        imageUrl: line.imageUrl,
        quantity: line.quantity,
        finalPriceXof: line.finalPriceXof,
        lineTotalXof: line.lineTotalXof,
        available: line.available,
        isMadeToOrder: line.isMadeToOrder,
        leadTimeDays: line.leadTimeDays,
        issue: line.issue,
      })),
    })),
  };
}

/**
 * Pourquoi une ligne n'est plus commandable.
 *
 * Un panier vit des jours : entre-temps l'atelier a pu retirer la pièce,
 * perdre son agrément ou vendre son stock. Le dire ligne par ligne, en clair,
 * vaut mieux qu'un refus global au moment de payer.
 */
function describeIssue(
  product: {
    status: string;
    hiddenAt: Date | null;
    deletedAt: Date | null;
    isMadeToOrder: boolean;
    maker: { kycStatus: string };
  },
  wanted: number,
  available: number,
): string | null {
  if (product.deletedAt || product.status !== 'PUBLISHED' || product.hiddenAt) {
    return "Cette pièce n'est plus disponible à la vente.";
  }
  if (product.maker.kycStatus !== 'APPROVED') {
    return "L'atelier n'est plus actif sur Ojà.";
  }
  if (product.isMadeToOrder) return null;
  if (available <= 0) return 'Cette pièce est en rupture.';
  if (wanted > available) {
    return `Il n'en reste que ${available}. Ajustez la quantité.`;
  }
  return null;
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function expiry(): Date {
  return new Date(Date.now() + CART_TTL_DAYS * 86_400_000);
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
