import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminPromoCode, PromoCodeInput, PromoCodeUpdateInput } from '@oja/contracts';
import type { Prisma, PromoCode } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';

/** Client Prisma ou client de transaction — l'évaluation sert dans les deux. */
type Db = PrismaService | Prisma.TransactionClient;

export interface PromoEvaluation {
  promoCodeId: string;
  code: string;
  /** « -10 % », « -2 000 F CFA » — prêt à afficher. */
  label: string;
  discountXof: number;
  /** Remise ramenée à la commission Ojà : moins que ce qu'annonce le libellé. */
  capped: boolean;
  /** Plafond global d'utilisations, pour l'incrément gardé à la commande. */
  maxRedemptions: number | null;
}

/**
 * Codes promo (cahier L2-11).
 *
 * Un principe tient tout le service : **la remise sort de la commission Ojà**,
 * jamais de la part due au créateur ou au livreur. L'évaluation reçoit donc un
 * plafond (`commissionCapXof`) et n'accorde jamais plus. Un créateur reste
 * toujours payé en entier, quoi qu'il arrive au panier.
 *
 * L'évaluation est refaite **dans la transaction** de création de commande :
 * un code peut s'épuiser entre l'affichage du panier et le clic.
 */
@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valide un code pour un client et un panier donnés, et calcule la remise.
   *
   * @param baseXof          assiette remisable : articles + livraison, hors TVA
   * @param commissionCapXof commission Ojà de la commande — plafond absolu
   * @throws BadRequestException  message prêt à afficher si le code ne s'applique pas
   */
  async evaluate(
    db: Db,
    rawCode: string,
    userId: string,
    baseXof: number,
    commissionCapXof: number,
  ): Promise<PromoEvaluation> {
    const code = rawCode.trim().toUpperCase();
    const promo = await db.promoCode.findUnique({ where: { code } });

    if (!promo || !promo.isActive) {
      throw new BadRequestException(`Code promo « ${code} » inconnu ou désactivé.`);
    }

    const now = new Date();
    if ((promo.startsAt && promo.startsAt > now) || (promo.endsAt && promo.endsAt < now)) {
      throw new BadRequestException(`Le code « ${code} » n'est pas (ou plus) valable.`);
    }

    if (baseXof < promo.minOrderXof) {
      throw new BadRequestException(
        `Le code « ${code} » s'applique à partir de ${money(promo.minOrderXof)} d'achat.`,
      );
    }

    if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
      throw new BadRequestException(`Le code « ${code} » a atteint sa limite d'utilisation.`);
    }

    const usedByUser = await db.promoRedemption.count({
      where: { promoCodeId: promo.id, userId },
    });
    if (usedByUser >= promo.perUserLimit) {
      throw new BadRequestException(`Vous avez déjà utilisé le code « ${code} ».`);
    }

    const raw =
      promo.kind === 'PERCENT'
        ? Math.floor((baseXof * (promo.valueBps ?? 0)) / 10_000)
        : (promo.amountXof ?? 0);

    // Jamais plus que l'assiette, jamais plus que la commission Ojà.
    const discountXof = Math.max(0, Math.min(raw, baseXof, commissionCapXof));

    if (discountXof === 0) {
      throw new BadRequestException(`Le code « ${code} » n'a pas d'effet sur ce panier.`);
    }

    return {
      promoCodeId: promo.id,
      code,
      label: labelOf(promo),
      discountXof,
      // Le client doit savoir qu'il reçoit moins que le libellé n'annonce.
      capped: discountXof < raw,
      maxRedemptions: promo.maxRedemptions,
    };
  }

  // ═══════════════════════════════ Back-office

  async list(): Promise<AdminPromoCode[]> {
    const codes = await this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    return codes.map(toAdminView);
  }

  async create(input: PromoCodeInput, adminId: string): Promise<AdminPromoCode> {
    const existing = await this.prisma.promoCode.findUnique({ where: { code: input.code } });
    if (existing) throw new BadRequestException('Ce code existe déjà.');

    const created = await this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.create({
        data: {
          code: input.code,
          kind: input.kind,
          valueBps: input.kind === 'PERCENT' ? (input.valueBps ?? null) : null,
          amountXof: input.kind === 'FIXED' ? (input.amountXof ?? null) : null,
          minOrderXof: input.minOrderXof,
          maxRedemptions: input.maxRedemptions ?? null,
          perUserLimit: input.perUserLimit,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: input.isActive,
          createdBy: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'promo.create',
          targetType: 'PromoCode',
          targetId: promo.id,
          after: { code: promo.code, kind: promo.kind },
        },
      });
      return promo;
    });

    return toAdminView(created);
  }

  async update(id: string, input: PromoCodeUpdateInput, adminId: string): Promise<AdminPromoCode> {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.promoCode.update({
        where: { id },
        data: {
          ...(input.minOrderXof !== undefined ? { minOrderXof: input.minOrderXof } : {}),
          ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
          ...(input.perUserLimit !== undefined ? { perUserLimit: input.perUserLimit } : {}),
          ...(input.endsAt !== undefined
            ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'promo.update',
          targetType: 'PromoCode',
          targetId: id,
          before: { isActive: promo.isActive, minOrderXof: promo.minOrderXof },
          after: { isActive: next.isActive, minOrderXof: next.minOrderXof },
        },
      });
      return next;
    });

    return toAdminView(updated);
  }
}

function labelOf(promo: PromoCode): string {
  return promo.kind === 'PERCENT'
    ? `-${((promo.valueBps ?? 0) / 100).toString().replace('.', ',')} %`
    : `-${money(promo.amountXof ?? 0)}`;
}

function toAdminView(promo: PromoCode): AdminPromoCode {
  return {
    id: promo.id,
    code: promo.code,
    kind: promo.kind,
    valueBps: promo.valueBps,
    amountXof: promo.amountXof,
    minOrderXof: promo.minOrderXof,
    maxRedemptions: promo.maxRedemptions,
    redemptionCount: promo.redemptionCount,
    perUserLimit: promo.perUserLimit,
    startsAt: promo.startsAt?.toISOString() ?? null,
    endsAt: promo.endsAt?.toISOString() ?? null,
    isActive: promo.isActive,
    createdAt: promo.createdAt.toISOString(),
  };
}

function money(amountXof: number): string {
  return `${amountXof.toLocaleString('fr-FR').replace(/ | /g, ' ')} F CFA`;
}
