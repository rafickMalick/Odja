import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GrantSubscriptionInput,
  MakerPlanSummary,
  MakerSubscriptionView,
  MyVisibility,
  VisibilityPlanInput,
  VisibilityPlanUpdateInput,
  VisibilityPlanView,
} from '@oja/contracts';
import type { MakerSubscription, VisibilityPlan } from '@oja/db';
import { activeSubscription, publicationQuotaProblem } from '@oja/domain';

import { PrismaService } from '../prisma/prisma.service';

type SubscriptionWithPlan = MakerSubscription & { plan: VisibilityPlan };

/** Formule résolue d'un atelier : celle de sa souscription en cours, sinon
 *  la formule par défaut. */
export interface ResolvedPlan {
  plan: VisibilityPlan;
  subscription: SubscriptionWithPlan | null;
}

/**
 * Souscriptions qui peuvent encore être en cours. Les périodes échues ou
 * résiliées sont écartées dès la requête : l'historique d'un atelier fidèle
 * grossit chaque mois, et l'annuaire n'en a pas besoin.
 */
export function liveSubscriptionsInclude(now = new Date()) {
  return {
    where: {
      cancelledAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { plan: true },
  };
}

/**
 * Formules de visibilité (cahier des évolutions, § 3 et § 11.2).
 *
 * Tant que le paiement en ligne du Premium n'existe pas, c'est l'équipe Ojà
 * qui active une formule après avoir reçu le règlement. Chaque activation et
 * chaque résiliation est journalisée.
 */
@Injectable()
export class VisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════ Résolution

  async defaultPlan(): Promise<VisibilityPlan> {
    const plan = await this.prisma.visibilityPlan.findFirst({ where: { isDefault: true } });
    /* La migration crée la formule Standard : son absence est une base mal
       initialisée, pas un cas métier. */
    if (!plan) throw new Error('Aucune formule de visibilité par défaut en base.');
    return plan;
  }

  resolve(
    subscriptions: readonly SubscriptionWithPlan[],
    fallback: VisibilityPlan,
    now = new Date(),
  ): ResolvedPlan {
    const subscription = activeSubscription(subscriptions, now);
    return { plan: subscription?.plan ?? fallback, subscription };
  }

  async resolveFor(makerId: string, now = new Date()): Promise<ResolvedPlan> {
    const [subscriptions, fallback] = await Promise.all([
      this.prisma.makerSubscription.findMany({
        where: { makerId, ...liveSubscriptionsInclude(now).where },
        include: { plan: true },
      }),
      this.defaultPlan(),
    ]);
    return this.resolve(subscriptions, fallback, now);
  }

  summary(resolved: ResolvedPlan): MakerPlanSummary {
    return {
      code: resolved.plan.code,
      name: resolved.plan.name,
      endsAt: resolved.subscription?.endsAt?.toISOString() ?? null,
      maxPublications: resolved.plan.maxPublications,
    };
  }

  /** Fiches qui comptent dans le quota : tout sauf les archives et les
   *  suppressions. */
  activeProductCount(makerId: string): Promise<number> {
    return this.prisma.product.count({
      where: { makerId, deletedAt: null, status: { not: 'ARCHIVED' } },
    });
  }

  /** Refuse la fiche de trop, avec un message qui dit quoi faire. */
  async assertCanAddProduct(makerId: string): Promise<void> {
    const [{ plan }, count] = await Promise.all([
      this.resolveFor(makerId),
      this.activeProductCount(makerId),
    ]);
    const problem = publicationQuotaProblem(count, plan.maxPublications, plan.name);
    if (problem) throw new BadRequestException(problem);
  }

  // ═══════════════════════════════ Espace créateur

  async mine(userId: string): Promise<MyVisibility> {
    const maker = await this.prisma.makerProfile.findUnique({ where: { userId } });
    if (!maker) throw new NotFoundException('Aucune boutique pour ce compte.');

    const [resolved, activeCount, plans, history] = await Promise.all([
      this.resolveFor(maker.id),
      this.activeProductCount(maker.id),
      this.listPlans({ activeOnly: true }),
      this.history(maker.id),
    ]);

    return { current: this.summary(resolved), activeCount, plans, history };
  }

  // ═══════════════════════════════ Administration — formules

  async listPlans(options: { activeOnly?: boolean } = {}): Promise<VisibilityPlanView[]> {
    const plans = await this.prisma.visibilityPlan.findMany({
      where: options.activeOnly ? { isActive: true } : {},
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map(toPlanView);
  }

  async createPlan(adminId: string, input: VisibilityPlanInput): Promise<VisibilityPlanView> {
    const taken = await this.prisma.visibilityPlan.findUnique({ where: { code: input.code } });
    if (taken) throw new ConflictException('Ce code de formule existe déjà.');

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visibilityPlan.create({
        data: { ...input, description: input.description ?? null },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'visibility.plan.create',
          targetType: 'VisibilityPlan',
          targetId: created.id,
          after: toPlanView(created) as object,
        },
      });
      return created;
    });
    return toPlanView(plan);
  }

  async updatePlan(
    adminId: string,
    planId: string,
    input: VisibilityPlanUpdateInput,
  ): Promise<VisibilityPlanView> {
    const before = await this.prisma.visibilityPlan.findUnique({ where: { id: planId } });
    if (!before) throw new NotFoundException();

    /* La formule par défaut s'applique à tous ceux qui ne paient rien : la
       désactiver laisserait des ateliers sans formule du tout. */
    if (before.isDefault && input.isActive === false) {
      throw new BadRequestException('La formule par défaut ne peut pas être désactivée.');
    }
    if (before.isDefault && input.durationDays) {
      throw new BadRequestException('La formule par défaut est sans échéance.');
    }

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) data[key] = value;
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.visibilityPlan.update({ where: { id: planId }, data });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'visibility.plan.update',
          targetType: 'VisibilityPlan',
          targetId: planId,
          before: toPlanView(before) as object,
          after: toPlanView(updated) as object,
        },
      });
      return updated;
    });
    return toPlanView(plan);
  }

  // ═══════════════════════════════ Administration — souscriptions

  async history(makerId: string): Promise<MakerSubscriptionView[]> {
    const now = new Date();
    const subscriptions = await this.prisma.makerSubscription.findMany({
      where: { makerId },
      include: { plan: true },
      orderBy: { startsAt: 'desc' },
      take: 50,
    });
    const current = activeSubscription(subscriptions, now);
    return subscriptions.map((subscription) => toSubscriptionView(subscription, current));
  }

  async grant(
    makerId: string,
    adminId: string,
    input: GrantSubscriptionInput,
  ): Promise<MakerSubscriptionView[]> {
    const maker = await this.prisma.makerProfile.findFirst({
      where: { id: makerId, deletedAt: null },
    });
    if (!maker) throw new NotFoundException();

    const plan = await this.prisma.visibilityPlan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Formule inconnue ou désactivée.');
    if (plan.isDefault) {
      throw new BadRequestException(
        'La formule par défaut s’applique d’elle-même : résiliez plutôt la formule en cours.',
      );
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const days = input.durationDays ?? plan.durationDays;
    const endsAt = days ? new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000) : null;

    await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.makerSubscription.create({
        data: {
          makerId,
          planId: plan.id,
          startsAt,
          endsAt,
          amountXof: input.amountXof,
          paymentReference: input.paymentReference ?? null,
          note: input.note ?? null,
          activatedById: adminId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'maker.subscription.grant',
          targetType: 'MakerProfile',
          targetId: makerId,
          after: {
            subscriptionId: subscription.id,
            plan: plan.code,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt?.toISOString() ?? null,
            amountXof: input.amountXof,
            paymentReference: input.paymentReference ?? null,
          },
        },
      });
    });

    return this.history(makerId);
  }

  async cancel(
    makerId: string,
    subscriptionId: string,
    adminId: string,
  ): Promise<MakerSubscriptionView[]> {
    const subscription = await this.prisma.makerSubscription.findFirst({
      where: { id: subscriptionId, makerId },
    });
    if (!subscription) throw new NotFoundException();
    if (subscription.cancelledAt) throw new ConflictException('Cette période est déjà résiliée.');

    await this.prisma.$transaction([
      this.prisma.makerSubscription.update({
        where: { id: subscriptionId },
        data: { cancelledAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'maker.subscription.cancel',
          targetType: 'MakerProfile',
          targetId: makerId,
          after: { subscriptionId },
        },
      }),
    ]);

    return this.history(makerId);
  }
}

function toPlanView(plan: VisibilityPlan): VisibilityPlanView {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    maxPublications: plan.maxPublications,
    durationDays: plan.durationDays,
    priceXof: plan.priceXof,
    perks: plan.perks,
    showBadge: plan.showBadge,
    boostInDirectory: plan.boostInDirectory,
    isDefault: plan.isDefault,
    isActive: plan.isActive,
    position: plan.position,
  };
}

function toSubscriptionView(
  subscription: SubscriptionWithPlan,
  current: SubscriptionWithPlan | null,
): MakerSubscriptionView {
  return {
    id: subscription.id,
    plan: { id: subscription.plan.id, code: subscription.plan.code, name: subscription.plan.name },
    startsAt: subscription.startsAt.toISOString(),
    endsAt: subscription.endsAt?.toISOString() ?? null,
    amountXof: subscription.amountXof,
    paymentReference: subscription.paymentReference,
    note: subscription.note,
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    createdAt: subscription.createdAt.toISOString(),
    active: current?.id === subscription.id,
  };
}
