import { z } from 'zod';

/**
 * Signalements et pilotage (cahier des évolutions, § 11 et § 13).
 *
 * Toute personne — connectée ou non — peut signaler une photo, une œuvre ou un
 * contenu publié sans autorisation. L'administration tranche, peut masquer le
 * contenu, et chaque décision est journalisée.
 */

export const REPORT_TARGETS = ['PRODUCT', 'MAKER', 'EXHIBITION', 'EXHIBITION_WORK'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  'UNAUTHORIZED_USE',
  'COUNTERFEIT',
  'INAPPROPRIATE',
  'MISLEADING',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(60),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().min(10, 'Décrivez le problème en quelques mots').max(2_000),
  /** Pour un visiteur non connecté : où lui répondre. */
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;

export const reportResolutionSchema = z.object({
  decision: z.enum(['RESOLVED', 'DISMISSED']),
  note: z.string().trim().min(3).max(1_000),
  /** Masque le contenu signalé : fiche masquée, exposition ou profil suspendu. */
  hideContent: z.boolean().default(false),
});
export type ReportResolutionInput = z.infer<typeof reportResolutionSchema>;

export interface ReportView {
  id: string;
  reference: string;
  targetType: ReportTarget;
  targetId: string;
  targetLabel: string;
  /** Lien vers le contenu, quand il existe encore. */
  targetHref: string | null;
  reason: ReportReason;
  details: string;
  reporter: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  resolution: string | null;
  contentHidden: boolean;
  handledAt: string | null;
  createdAt: string;
}

export const makerSuspensionSchema = z.object({
  reason: z.string().trim().min(5, 'Motif : 5 caractères au minimum').max(500),
});
export type MakerSuspensionInput = z.infer<typeof makerSuspensionSchema>;

/** Tableau de bord des évolutions créatives (§ 11). */
export interface CreativeOverview {
  professionalsPending: number;
  apprenticesPending: number;
  premiumActive: number;
  suspendedMakers: number;
  exhibitionsToReview: number;
  exhibitionsAwaitingContract: number;
  exhibitionsLive: number;
  reportsOpen: number;
  passesConfirmedThisMonth: number;
}
