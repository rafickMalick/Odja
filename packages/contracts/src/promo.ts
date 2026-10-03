import { z } from 'zod';

/**
 * Codes promo (cahier L2-11).
 *
 * La remise sort **toujours** de la commission Ojà, jamais de la part due au
 * créateur ou au livreur : le back-office la borne à la commission de la
 * commande. Un code absent, expiré ou épuisé n'est pas une erreur silencieuse —
 * le chiffrage le signale comme un point à corriger, au même titre qu'une
 * rupture de stock.
 */

export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

export const promoCodeInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(PROMO_CODE_RE, 'Lettres majuscules, chiffres et tirets, 3 à 40 caractères'),
    kind: z.enum(['PERCENT', 'FIXED']),
    /** Points de base pour `PERCENT` (1000 = 10 %). */
    valueBps: z.number().int().min(1).max(10_000).optional(),
    /** Montant en XOF pour `FIXED`. */
    amountXof: z.number().int().min(1).optional(),
    minOrderXof: z.number().int().min(0).default(0),
    maxRedemptions: z.number().int().min(1).optional(),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => (v.kind === 'PERCENT' ? v.valueBps !== undefined : v.amountXof !== undefined), {
    message: 'Renseignez le pourcentage (PERCENT) ou le montant (FIXED)',
    path: ['valueBps'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, {
    message: 'La fin doit suivre le début',
    path: ['endsAt'],
  });
export type PromoCodeInput = z.infer<typeof promoCodeInputSchema>;

export const promoCodeUpdateSchema = z.object({
  minOrderXof: z.number().int().min(0).optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type PromoCodeUpdateInput = z.infer<typeof promoCodeUpdateSchema>;

/** Code appliqué au chiffrage ou à l'aperçu. */
export const applyPromoSchema = z.object({
  addressId: z.string().min(1, 'Adresse de livraison requise'),
  code: z.string().trim().toUpperCase().min(3).max(40),
});
export type ApplyPromoInput = z.infer<typeof applyPromoSchema>;

export interface PromoView {
  code: string;
  /** « -10 % », « -2 000 F CFA » — prêt à afficher. */
  label: string;
  discountXof: number;
  /** Remise ramenée à la commission Ojà : moins que ce qu'annonce le libellé. */
  capped: boolean;
}

export interface AdminPromoCode {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  valueBps: number | null;
  amountXof: number | null;
  minOrderXof: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  perUserLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
}
