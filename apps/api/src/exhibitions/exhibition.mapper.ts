import type {
  AdminExhibition,
  AdminExhibitionSummary,
  ExhibitionCard,
  ExhibitionPlanView,
  OrganizerExhibition,
  OrganizerExhibitionWork,
  PublicExhibitionWork,
} from '@oja/contracts';
import type {
  City,
  Country,
  Exhibition,
  ExhibitionPlan,
  ExhibitionWork,
  MakerProfile,
  Product,
  ProductImage,
  User,
} from '@oja/db';
import {
  commissionFor,
  displayAvailability,
  exhibitionPeriod,
  isPurchasable,
  whyExhibitionNotSubmittable,
  whyNotSchedulable,
} from '@oja/domain';

/**
 * Frontière entre les trois lectures d'une exposition.
 *
 * Le dossier de présentation, les justificatifs de propriété, les notes de
 * l'administration et les références de paiement ne sortent que vers
 * l'organisateur et l'administration. La vue publique est composée à part,
 * champ par champ, pour qu'un ajout au modèle ne puisse pas y fuiter par
 * mégarde.
 */

export type WorkWithProduct = ExhibitionWork & {
  product:
    | (Product & {
        maker: Pick<MakerProfile, 'commissionBps'>;
        images: Pick<ProductImage, 'fileKey'>[];
      })
    | null;
};

export type FullExhibition = Exhibition & {
  city: City & { country: Pick<Country, 'name'> };
  plan: ExhibitionPlan | null;
  works: WorkWithProduct[];
  organizer: Pick<User, 'email' | 'role'>;
  maker: Pick<MakerProfile, 'slug' | 'kycStatus'> | null;
};

export interface MapperContext {
  imageUrl: (fileKey: string) => string;
  defaultCommissionBps: number;
  now: Date;
}

export const FULL_EXHIBITION_INCLUDE = {
  city: { include: { country: { select: { name: true } } } },
  plan: true,
  works: {
    orderBy: { position: 'asc' as const },
    include: {
      product: {
        include: {
          maker: { select: { commissionBps: true } },
          images: { orderBy: { position: 'asc' as const }, take: 3, select: { fileKey: true } },
        },
      },
    },
  },
  organizer: { select: { email: true, role: true } },
  maker: { select: { slug: true, kycStatus: true } },
};

export function toPlanView(plan: ExhibitionPlan): ExhibitionPlanView {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    maxWorks: plan.maxWorks,
    maxDurationDays: plan.maxDurationDays,
    priceXof: plan.priceXof,
    perks: plan.perks,
    featuredPlacement: plan.featuredPlacement,
    communicationSupport: plan.communicationSupport,
    isActive: plan.isActive,
    position: plan.position,
  };
}

export function toCard(
  exhibition: Exhibition & { city: City & { country: Pick<Country, 'name'> } },
  workCount: number,
  context: MapperContext,
): ExhibitionCard {
  return {
    id: exhibition.id,
    slug: exhibition.slug,
    title: exhibition.title,
    organizerName: exhibition.organizerName,
    coverUrl: exhibition.coverKey ? context.imageUrl(exhibition.coverKey) : null,
    city: exhibition.city.name,
    country: exhibition.city.country.name,
    startsAt: exhibition.startsAt.toISOString(),
    endsAt: exhibition.endsAt.toISOString(),
    format: exhibition.format,
    period: exhibitionPeriod(exhibition, context.now),
    accessMode: exhibition.accessMode,
    ticketPriceXof: exhibition.ticketPriceXof,
    isFeatured: exhibition.isFeatured,
    workCount,
  };
}

/** Une œuvre telle que le visiteur la voit. */
export function toPublicWork(work: WorkWithProduct, context: MapperContext): PublicExhibitionWork {
  const product = work.product;
  /* Une œuvre sans photo propre emprunte celles de sa fiche : l'organisateur
     n'a pas à téléverser deux fois la même image. */
  const images =
    work.imageKeys.length > 0 ? work.imageKeys : (product?.images.map((image) => image.fileKey) ?? []);

  return {
    id: work.id,
    title: work.title,
    artistName: work.artistName,
    description: work.description,
    materials: work.materials,
    dimensions: work.dimensions,
    imageUrls: images.map(context.imageUrl),
    product:
      product && product.status === 'PUBLISHED' && !product.hiddenAt && !product.deletedAt
        ? {
            id: product.id,
            slug: product.slug,
            finalPriceXof:
              product.makerPriceXof +
              commissionFor(
                product.makerPriceXof,
                product.maker.commissionBps || context.defaultCommissionBps,
              ),
            availability: displayAvailability(product),
            purchasable: isPurchasable(product),
          }
        : null,
  };
}

function toOrganizerWork(work: WorkWithProduct, context: MapperContext): OrganizerExhibitionWork {
  return {
    id: work.id,
    position: work.position,
    title: work.title,
    artistName: work.artistName,
    description: work.description,
    materials: work.materials,
    dimensions: work.dimensions,
    imageUrls: work.imageKeys.map(context.imageUrl),
    imageKeys: work.imageKeys,
    hasProof: Boolean(work.proofKey),
    productId: work.productId,
    productName: work.product?.name ?? null,
    reviewStatus: work.reviewStatus,
    reviewNote: work.reviewNote,
  };
}

export function toOrganizerView(
  exhibition: FullExhibition,
  context: MapperContext,
): OrganizerExhibition {
  const blockers = whyExhibitionNotSubmittable(
    {
      title: exhibition.title,
      summary: exhibition.summary,
      startsAt: exhibition.startsAt,
      endsAt: exhibition.endsAt,
      format: exhibition.format,
      venueName: exhibition.venueName,
      venueAddress: exhibition.venueAddress,
      accessMode: exhibition.accessMode,
      ticketPriceXof: exhibition.ticketPriceXof,
      hasAccessCode: Boolean(exhibition.accessCodeHash),
      planId: exhibition.planId,
    },
    exhibition.works.length,
    exhibition.plan,
  );

  return {
    id: exhibition.id,
    slug: exhibition.slug,
    status: exhibition.status,
    title: exhibition.title,
    organizerName: exhibition.organizerName,
    summary: exhibition.summary,
    objective: exhibition.objective,
    discipline: exhibition.discipline,
    cityId: exhibition.cityId,
    city: exhibition.city.name,
    startsAt: exhibition.startsAt.toISOString(),
    endsAt: exhibition.endsAt.toISOString(),
    openingHours: exhibition.openingHours,
    format: exhibition.format,
    venueName: exhibition.venueName,
    venueAddress: exhibition.venueAddress,
    venueDescription: exhibition.venueDescription,
    venueImageUrls: exhibition.venueImageKeys.map(context.imageUrl),
    coverUrl: exhibition.coverKey ? context.imageUrl(exhibition.coverKey) : null,
    hasDossier: Boolean(exhibition.dossierKey),
    plannedWorkCount: exhibition.plannedWorkCount,
    plan: exhibition.plan ? toPlanView(exhibition.plan) : null,
    accessMode: exhibition.accessMode,
    ticketPriceXof: exhibition.ticketPriceXof,
    requiresRegistration: exhibition.requiresRegistration,
    hasAccessCode: Boolean(exhibition.accessCodeHash),
    onsiteInfo: exhibition.onsiteInfo,
    remoteInfo: exhibition.remoteInfo,
    reviewNote: exhibition.reviewNote,
    contractSentAt: exhibition.contractSentAt?.toISOString() ?? null,
    contractSignedAt: exhibition.contractSignedAt?.toISOString() ?? null,
    paymentReceivedAt: exhibition.paymentReceivedAt?.toISOString() ?? null,
    publishAt: exhibition.publishAt?.toISOString() ?? null,
    canSellWorks: exhibition.maker?.kycStatus === 'APPROVED',
    blockers,
    works: exhibition.works.map((work) => toOrganizerWork(work, context)),
  };
}

export function toAdminView(exhibition: FullExhibition, context: MapperContext): AdminExhibition {
  const scheduleBlockers = whyNotSchedulable({
    contractSignedAt: exhibition.contractSignedAt,
    paymentReceivedAt: exhibition.paymentReceivedAt,
    priceXof: exhibition.plan?.priceXof ?? 0,
  });
  const pending = exhibition.works.filter((work) => work.reviewStatus === 'PENDING').length;
  if (pending > 0) scheduleBlockers.push(`la validation de ${pending} œuvre(s)`);
  if (!exhibition.works.some((work) => work.reviewStatus === 'APPROVED')) {
    scheduleBlockers.push('au moins une œuvre validée');
  }

  return {
    ...toOrganizerView(exhibition, context),
    organizerEmail: exhibition.organizer.email,
    organizerRole: exhibition.organizer.role,
    submittedAt: exhibition.submittedAt?.toISOString() ?? null,
    reviewedAt: exhibition.reviewedAt?.toISOString() ?? null,
    contractReference: exhibition.contractReference,
    paymentAmountXof: exhibition.paymentAmountXof,
    paymentReference: exhibition.paymentReference,
    publishedAt: exhibition.publishedAt?.toISOString() ?? null,
    suspendedAt: exhibition.suspendedAt?.toISOString() ?? null,
    suspendReason: exhibition.suspendReason,
    isFeatured: exhibition.isFeatured,
    viewCount: exhibition.viewCount,
    scheduleBlockers,
  };
}

export function toAdminSummary(
  exhibition: Exhibition & { plan: ExhibitionPlan | null; works: Pick<ExhibitionWork, 'reviewStatus'>[] },
): AdminExhibitionSummary {
  return {
    id: exhibition.id,
    slug: exhibition.slug,
    title: exhibition.title,
    organizerName: exhibition.organizerName,
    status: exhibition.status,
    startsAt: exhibition.startsAt.toISOString(),
    endsAt: exhibition.endsAt.toISOString(),
    planName: exhibition.plan?.name ?? null,
    submittedAt: exhibition.submittedAt?.toISOString() ?? null,
    workCount: exhibition.works.length,
    pendingWorkCount: exhibition.works.filter((work) => work.reviewStatus === 'PENDING').length,
    isFeatured: exhibition.isFeatured,
  };
}
