import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminReviewView,
  CustomerReviewInput,
  ModerateReviewInput,
  OwnReviewView,
  ProductReviews,
  ReviewStatus,
} from '@oja/contracts';
import type { Prisma } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_PAGE = 20;

/**
 * Avis clients (cahier L6-11, L6-12).
 *
 * Trois règles, tenues ici et pas seulement à l'écran :
 *
 *   · **achat réel** : l'avis porte sur une ligne d'une commande du client,
 *     et seulement une fois la réception **validée** — on ne note pas une
 *     pièce qu'on n'a pas eue entre les mains ;
 *   · **un seul avis par ligne**, garanti par l'unicité en base ;
 *   · **modération avant publication** : un avis attend la décision d'un
 *     administrateur. Publier ou retirer un avis recalcule la note moyenne
 *     de la pièce **et** de l'atelier, dans la même transaction.
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    orderLineId: string,
    input: CustomerReviewInput & { rating: number },
  ): Promise<OwnReviewView> {
    const line = await this.prisma.orderLine.findFirst({
      // La propriété est dans le WHERE : la ligne d'un autre client est 404.
      where: { id: orderLineId, subOrder: { order: { customerId: userId } } },
      include: { subOrder: { select: { status: true } }, review: { select: { id: true } } },
    });
    if (!line) throw new NotFoundException();

    if (line.subOrder.status !== 'VALIDATED') {
      throw new BadRequestException(
        'Vous pourrez donner votre avis une fois la réception de cette pièce validée.',
      );
    }
    if (line.review) {
      throw new ConflictException('Vous avez déjà donné votre avis sur cette pièce.');
    }

    try {
      const review = await this.prisma.review.create({
        data: {
          orderLineId,
          productId: line.productId,
          authorId: userId,
          rating: input.rating,
          body: input.body ?? null,
        },
      });
      return toOwnView(review);
    } catch (error) {
      // Deux envois simultanés : l'unicité en base départage.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Vous avez déjà donné votre avis sur cette pièce.');
      }
      throw error;
    }
  }

  /** Avis publiés d'une pièce en ligne, du plus récent au plus ancien. */
  async forProduct(slug: string): Promise<ProductReviews> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED', hiddenAt: null },
      select: { id: true, ratingAvg: true, ratingCount: true },
    });
    if (!product) throw new NotFoundException();

    const reviews = await this.prisma.review.findMany({
      where: { productId: product.id, status: 'PUBLISHED' },
      include: { author: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: PUBLIC_PAGE,
    });

    return {
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
      items: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        authorName: publicName(review.author),
        createdAt: review.createdAt.toISOString(),
      })),
    };
  }

  async listForModeration(status: ReviewStatus = 'PENDING'): Promise<AdminReviewView[]> {
    const reviews = await this.prisma.review.findMany({
      where: { status },
      include: {
        author: { select: { firstName: true, lastName: true } },
        product: { select: { name: true, slug: true, maker: { select: { shopName: true } } } },
      },
      // La file se traite dans l'ordre d'arrivée ; l'historique, du plus récent.
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
    });

    return reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: review.body,
      status: review.status as ReviewStatus,
      productName: review.product.name,
      productSlug: review.product.slug,
      shopName: review.product.maker.shopName,
      authorName: publicName(review.author),
      createdAt: review.createdAt.toISOString(),
      rejectReason: review.rejectReason,
    }));
  }

  /**
   * Publie ou refuse. Une décision peut être revue (publier un avis refusé,
   * retirer un avis publié) : les notes sont recalculées à chaque fois.
   */
  async moderate(id: string, adminId: string, input: ModerateReviewInput): Promise<AdminReviewView> {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: { product: { select: { makerId: true } } },
    });
    if (!review) throw new NotFoundException('Avis introuvable.');

    const status: ReviewStatus = input.decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';

    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id },
        data: {
          status,
          moderatedAt: new Date(),
          moderatorId: adminId,
          rejectReason: status === 'REJECTED' ? (input.reason ?? null) : null,
        },
      });
      await recomputeRatings(tx, review.productId, review.product.makerId);
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorRole: 'ADMIN',
          action: status === 'PUBLISHED' ? 'review.publish' : 'review.reject',
          targetType: 'Review',
          targetId: id,
          before: { status: review.status },
          after: { status, ...(input.reason ? { reason: input.reason } : {}) },
        },
      });
    });

    const [view] = (await this.listForModeration(status)).filter((item) => item.id === id);
    return view!;
  }
}

/**
 * Notes moyennes recalculées depuis les avis publiés, jamais incrémentées :
 * un avis retiré ou republié ne peut pas faire dériver la moyenne.
 */
export async function recomputeRatings(
  tx: Prisma.TransactionClient,
  productId: string,
  makerId: string,
): Promise<void> {
  const product = await tx.review.aggregate({
    where: { productId, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg: round1(product._avg.rating), ratingCount: product._count._all },
  });

  const maker = await tx.review.aggregate({
    where: { product: { makerId }, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.makerProfile.update({
    where: { id: makerId },
    data: { ratingAvg: round1(maker._avg.rating), ratingCount: maker._count._all },
  });
}

function round1(value: number | null): number {
  return value === null ? 0 : Math.round(value * 10) / 10;
}

/** « Awa K. » : un avis public ne donne jamais le nom complet de son auteur. */
export function publicName(author: { firstName: string; lastName: string }): string {
  const initial = author.lastName.trim().charAt(0).toUpperCase();
  return initial ? `${author.firstName.trim()} ${initial}.` : author.firstName.trim();
}

export function toOwnView(review: {
  rating: number;
  status: string;
  rejectReason: string | null;
}): OwnReviewView {
  return {
    rating: review.rating,
    status: review.status as ReviewStatus,
    rejectReason: review.rejectReason,
  };
}
