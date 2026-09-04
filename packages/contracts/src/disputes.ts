import { z } from 'zod';

/**
 * Réclamations et avis.
 *
 * Règle de remboursement du cahier client : « seul le prix du produit est
 * remboursé ; les frais de livraison et la commission restent acquis selon la
 * politique de la plateforme ». Le « selon la politique » laisse une marge :
 * l'administration peut exceptionnellement rendre aussi la livraison, mais
 * elle doit le décider, pas le subir.
 */

export const disputeReasonSchema = z.enum([
  'non_conforme',
  'casse',
  'incomplet',
  'non_recu',
  'autre',
]);
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

export const DISPUTE_REASON_LABELS: Readonly<Record<DisputeReason, string>> = {
  non_conforme: 'La pièce ne correspond pas à l’annonce',
  casse: 'La pièce est arrivée cassée',
  incomplet: 'Il manque des éléments',
  non_recu: 'Je n’ai rien reçu',
  autre: 'Autre motif',
};

export const openDisputeSchema = z.object({
  reason: disputeReasonSchema,
  description: z.string().trim().min(10, 'Décrivez le problème').max(2_000),
  /** Photos du problème : elles font la différence en arbitrage. */
  fileKeys: z.array(z.string().trim().max(300)).max(5).default([]),
});
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export const disputeMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message vide').max(2_000),
  fileKeys: z.array(z.string().trim().max(300)).max(5).default([]),
  /** Note d'équipe, invisible des parties. Réservée à l'administration. */
  isInternal: z.boolean().default(false),
});
export type DisputeMessageInput = z.infer<typeof disputeMessageSchema>;

export const resolveDisputeSchema = z
  .object({
    decision: z.enum(['REFUND', 'REJECT']),
    /** Motivation, transmise aux deux parties. */
    note: z.string().trim().min(4, 'Motivez la décision').max(1_000),
    /**
     * Geste commercial : rendre aussi les frais de livraison. Faux par défaut,
     * conformément à la règle du cahier client — c'est une exception que
     * l'administration assume, pas un réglage silencieux.
     */
    refundDelivery: z.boolean().default(false),
    /** Qui supporte la perte : le créateur, ou Ojà. */
    chargeToMaker: z.boolean().default(true),
  })
  .refine((input) => input.decision === 'REFUND' || !input.refundDelivery, {
    path: ['refundDelivery'],
    message: 'Un rejet ne peut pas rembourser la livraison',
  });
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export interface DisputeMessageView {
  id: string;
  authorId: string;
  fromAdmin: boolean;
  body: string;
  fileKeys: string[];
  createdAt: string;
}

export interface DisputeView {
  reference: string;
  orderReference: string;
  subOrderReference: string | null;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
  statusLabel: string;
  reason: DisputeReason;
  reasonLabel: string;
  resolution: string | null;
  refundXof: number | null;
  slaDueAt: string;
  /** Vrai quand le délai de traitement est dépassé. */
  overdue: boolean;
  messages: DisputeMessageView[];
  createdAt: string;
  resolvedAt: string | null;
}

// ═══════════════════════════════════════════ Avis

export const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Note entre 1 et 5').max(5),
  body: z.string().trim().max(2_000).optional(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export interface PublicReview {
  id: string;
  rating: number;
  body: string | null;
  authorFirstName: string;
  createdAt: string;
}
