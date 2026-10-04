import { z } from 'zod';

/**
 * Avis clients (cahier L6-11, L6-12).
 *
 * Un avis porte sur une **ligne de commande réellement achetée**, une fois la
 * réception validée. Il est publié après modération.
 */

export const customerReviewSchema = z.object({
  rating: z.coerce
    .number()
    .int('Choisissez une note de 1 à 5')
    .min(1, 'Choisissez une note de 1 à 5')
    .max(5, 'Choisissez une note de 1 à 5'),
  body: z
    .string()
    .trim()
    .max(1_000, 'Votre avis est trop long (1 000 caractères au plus)')
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type CustomerReviewInput = z.input<typeof customerReviewSchema>;

export type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED';

/** L'avis du client sur une ligne de sa commande. */
export interface OwnReviewView {
  rating: number;
  status: ReviewStatus;
  rejectReason: string | null;
}

/** Avis publié, tel que l'affiche la fiche produit. */
export interface PublicReviewView {
  id: string;
  rating: number;
  body: string | null;
  /** « Awa K. » : prénom et initiale, jamais le nom complet. */
  authorName: string;
  createdAt: string;
}

export interface ProductReviews {
  ratingAvg: number;
  ratingCount: number;
  items: PublicReviewView[];
}

/** File de modération, côté administration. */
export interface AdminReviewView {
  id: string;
  rating: number;
  body: string | null;
  status: ReviewStatus;
  productName: string;
  productSlug: string;
  shopName: string;
  authorName: string;
  createdAt: string;
  rejectReason: string | null;
}

export const moderateReviewSchema = z
  .object({
    decision: z.enum(['PUBLISH', 'REJECT'], {
      errorMap: () => ({ message: 'Publier ou refuser' }),
    }),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.decision === 'PUBLISH' || Boolean(value.reason), {
    path: ['reason'],
    message: 'Indiquez le motif du refus : il est montré à l’auteur',
  });
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
