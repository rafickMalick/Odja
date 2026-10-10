import { z } from 'zod';

import type { DisplayAvailability } from './catalog';

/**
 * Expositions (cahier des évolutions, § 6 à 10).
 *
 * Trois publics lisent ces contrats : l'organisateur qui monte son dossier,
 * l'administration qui l'instruit, le visiteur qui découvre l'exposition. Les
 * vues sont distinctes : le dossier de présentation, les justificatifs de
 * propriété et les échanges avec l'administration ne sortent jamais vers le
 * public.
 */

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} : ${min} caractères au minimum`).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const isoDate = z.string().datetime({ offset: true, message: 'Date invalide' });

export const EXHIBITION_FORMATS = ['PHYSICAL', 'ONLINE', 'HYBRID'] as const;
export type ExhibitionFormat = (typeof EXHIBITION_FORMATS)[number];

export const EXHIBITION_ACCESS_MODES = ['FREE', 'PAID', 'RESTRICTED'] as const;
export type ExhibitionAccessMode = (typeof EXHIBITION_ACCESS_MODES)[number];

export type ExhibitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'ACCEPTED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'SUSPENDED';

export type ExhibitionPeriod = 'UPCOMING' | 'ONGOING' | 'ENDED';
export type AccessRequirement = 'OPEN' | 'REGISTER' | 'TICKET' | 'CODE';

// ═══════════════════════════════════════════ Dossier de l'organisateur

export const exhibitionSchema = z.object({
  // Informations générales (§ 6.3)
  title: text(3, 140, 'Nom de l’exposition'),
  organizerName: text(2, 120, 'Organisateur'),
  summary: text(30, 4_000, 'Présentation'),
  objective: optionalText(1_000),
  discipline: optionalText(120),
  cityId: z.string().min(1, 'Ville requise'),

  // Calendrier
  startsAt: isoDate,
  endsAt: isoDate,
  openingHours: optionalText(300),

  // Format et lieu
  format: z.enum(EXHIBITION_FORMATS),
  venueName: optionalText(160),
  venueAddress: optionalText(300),
  venueDescription: optionalText(2_000),
  plannedWorkCount: z.number().int().min(1).max(10_000).optional(),

  planId: z.string().min(1).optional(),

  // Accès (§ 8.1)
  accessMode: z.enum(EXHIBITION_ACCESS_MODES).default('FREE'),
  ticketPriceXof: z.number().int().min(0).max(10_000_000).default(0),
  requiresRegistration: z.boolean().default(false),
  /** Code transmis aux personnes autorisées. Stocké sous forme d'empreinte. */
  accessCode: z.string().trim().min(4, 'Code : 4 caractères au minimum').max(40).optional(),
  onsiteInfo: optionalText(1_000),
  remoteInfo: optionalText(1_000),
});
export type ExhibitionInput = z.infer<typeof exhibitionSchema>;

export const exhibitionUpdateSchema = exhibitionSchema.partial();
export type ExhibitionUpdateInput = z.infer<typeof exhibitionUpdateSchema>;

/** Fichier rattaché au dossier, une fois envoyé au stockage. */
export const exhibitionFileSchema = z.object({
  slot: z.enum(['cover', 'dossier', 'venue']),
  fileKey: z.string().trim().min(1).max(300),
});
export type ExhibitionFileInput = z.infer<typeof exhibitionFileSchema>;

export const exhibitionWorkSchema = z.object({
  title: text(2, 160, 'Titre'),
  artistName: text(2, 120, 'Artiste'),
  description: text(10, 3_000, 'Description'),
  materials: optionalText(200),
  dimensions: optionalText(120),
  /** Fiche du catalogue de l'organisateur, pour une œuvre en vente. */
  productId: z.string().min(1).optional(),
  imageKeys: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
  proofKey: z.string().trim().min(1).max(300).optional(),
});
export type ExhibitionWorkInput = z.infer<typeof exhibitionWorkSchema>;

export const exhibitionWorkUpdateSchema = exhibitionWorkSchema.partial();
export type ExhibitionWorkUpdateInput = z.infer<typeof exhibitionWorkUpdateSchema>;

// ═══════════════════════════════════════════ Instruction par l'administration

export const exhibitionReviewSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT', 'REQUEST_CHANGES']),
  note: z.string().trim().max(1_000).optional(),
});
export type ExhibitionReviewInput = z.infer<typeof exhibitionReviewSchema>;

export const exhibitionWorkReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
export type ExhibitionWorkReviewInput = z.infer<typeof exhibitionWorkReviewSchema>;

export const exhibitionContractSchema = z.object({
  contractReference: z.string().trim().min(2).max(120).optional(),
  sent: z.boolean().optional(),
  signed: z.boolean().optional(),
});
export type ExhibitionContractInput = z.infer<typeof exhibitionContractSchema>;

export const exhibitionPaymentSchema = z.object({
  amountXof: z.number().int().min(0).max(100_000_000),
  reference: text(2, 120, 'Référence'),
});
export type ExhibitionPaymentInput = z.infer<typeof exhibitionPaymentSchema>;

export const exhibitionScheduleSchema = z.object({ publishAt: isoDate });
export type ExhibitionScheduleInput = z.infer<typeof exhibitionScheduleSchema>;

export const exhibitionSuspendSchema = z.object({ reason: text(5, 500, 'Motif') });
export type ExhibitionSuspendInput = z.infer<typeof exhibitionSuspendSchema>;

export const exhibitionFeatureSchema = z.object({ isFeatured: z.boolean() });

// ═══════════════════════════════════════════ Formules

export const exhibitionPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Code en minuscules, chiffres et tirets'),
  name: text(2, 60, 'Nom'),
  description: z.string().trim().max(500).optional(),
  maxWorks: z.number().int().min(1).max(10_000).nullable(),
  maxDurationDays: z.number().int().min(1).max(3_650).nullable(),
  priceXof: z.number().int().min(0).max(100_000_000),
  perks: z.array(z.string().trim().min(2).max(160)).max(12),
  featuredPlacement: z.boolean(),
  communicationSupport: z.boolean(),
  isActive: z.boolean(),
  position: z.number().int().min(0).max(100),
});
export type ExhibitionPlanInput = z.infer<typeof exhibitionPlanSchema>;
export const exhibitionPlanUpdateSchema = exhibitionPlanSchema.omit({ code: true }).partial();
export type ExhibitionPlanUpdateInput = z.infer<typeof exhibitionPlanUpdateSchema>;

export interface ExhibitionPlanView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxWorks: number | null;
  maxDurationDays: number | null;
  priceXof: number;
  perks: string[];
  featuredPlacement: boolean;
  communicationSupport: boolean;
  isActive: boolean;
  position: number;
}

// ═══════════════════════════════════════════ Vues

/** Ce qu'un visiteur voit d'une œuvre exposée (§ 7.2). */
export interface PublicExhibitionWork {
  id: string;
  title: string;
  artistName: string;
  description: string;
  materials: string | null;
  dimensions: string | null;
  imageUrls: string[];
  /** Fiche du catalogue, quand l'œuvre est en vente. */
  product: {
    id: string;
    slug: string;
    finalPriceXof: number;
    availability: DisplayAvailability;
    purchasable: boolean;
  } | null;
}

/** Carte d'une exposition dans la rubrique Expositions. */
export interface ExhibitionCard {
  id: string;
  slug: string;
  title: string;
  organizerName: string;
  coverUrl: string | null;
  city: string;
  country: string;
  startsAt: string;
  endsAt: string;
  format: ExhibitionFormat;
  period: ExhibitionPeriod;
  accessMode: ExhibitionAccessMode;
  ticketPriceXof: number;
  isFeatured: boolean;
  workCount: number;
}

export interface PublicExhibition extends ExhibitionCard {
  summary: string;
  objective: string | null;
  discipline: string | null;
  openingHours: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueDescription: string | null;
  venueImageUrls: string[];
  onsiteInfo: string | null;
  remoteInfo: string | null;
  organizer: { makerSlug: string | null };
  requirement: AccessRequirement;
  /** Le visiteur peut-il voir la galerie ? */
  unlocked: boolean;
  /** Nulle tant que la galerie est verrouillée. */
  works: PublicExhibitionWork[] | null;
}

export interface OrganizerExhibitionWork {
  id: string;
  position: number;
  title: string;
  artistName: string;
  description: string;
  materials: string | null;
  dimensions: string | null;
  imageUrls: string[];
  imageKeys: string[];
  hasProof: boolean;
  productId: string | null;
  productName: string | null;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
}

/** Le dossier tel que l'organisateur le voit et l'édite. */
export interface OrganizerExhibition {
  id: string;
  slug: string;
  status: ExhibitionStatus;
  title: string;
  organizerName: string;
  summary: string;
  objective: string | null;
  discipline: string | null;
  cityId: string;
  city: string;
  startsAt: string;
  endsAt: string;
  openingHours: string | null;
  format: ExhibitionFormat;
  venueName: string | null;
  venueAddress: string | null;
  venueDescription: string | null;
  venueImageUrls: string[];
  coverUrl: string | null;
  hasDossier: boolean;
  plannedWorkCount: number | null;
  plan: ExhibitionPlanView | null;
  accessMode: ExhibitionAccessMode;
  ticketPriceXof: number;
  requiresRegistration: boolean;
  hasAccessCode: boolean;
  onsiteInfo: string | null;
  remoteInfo: string | null;
  reviewNote: string | null;
  contractSentAt: string | null;
  contractSignedAt: string | null;
  paymentReceivedAt: string | null;
  publishAt: string | null;
  canSellWorks: boolean;
  /** Ce qui manque pour soumettre, tout à la fois. */
  blockers: string[];
  works: OrganizerExhibitionWork[];
}

/** Vue de l'administration : le dossier, plus ce qui ne sort jamais. */
export interface AdminExhibition extends OrganizerExhibition {
  organizerEmail: string;
  organizerRole: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  contractReference: string | null;
  paymentAmountXof: number | null;
  paymentReference: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  isFeatured: boolean;
  viewCount: number;
  /** Ce qui manque encore pour programmer la mise en ligne. */
  scheduleBlockers: string[];
}

export interface AdminExhibitionSummary {
  id: string;
  slug: string;
  title: string;
  organizerName: string;
  status: ExhibitionStatus;
  startsAt: string;
  endsAt: string;
  planName: string | null;
  submittedAt: string | null;
  workCount: number;
  pendingWorkCount: number;
  isFeatured: boolean;
}

/** Lien de lecture d'une pièce privée, délivré à la demande. */
export interface PrivateFileLink {
  label: string;
  url: string;
}

// ═══════════════════════════════════════════ Billetterie (§ 8)

export const PASS_FORMATS = ['ONSITE', 'ONLINE'] as const;
export type PassFormat = (typeof PASS_FORMATS)[number];

export const passRequestSchema = z.object({
  /** Sur place ou à distance ; une exposition en ligne n'en propose qu'un. */
  format: z.enum(PASS_FORMATS).default('ONLINE'),
});
export type PassRequestInput = z.infer<typeof passRequestSchema>;

export const accessCodeSchema = z.object({
  code: z.string().trim().min(4).max(40),
  format: z.enum(PASS_FORMATS).default('ONLINE'),
});
export type AccessCodeInput = z.infer<typeof accessCodeSchema>;

export type PassKind = 'REGISTRATION' | 'TICKET' | 'INVITATION';
export type PassStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';

export interface ExhibitionPassView {
  reference: string;
  exhibition: { slug: string; title: string; startsAt: string; endsAt: string };
  kind: PassKind;
  format: PassFormat;
  status: PassStatus;
  amountXof: number;
  paidAt: string | null;
  createdAt: string;
}

/** Billet en attente de paiement, et ce que le front doit présenter. */
export interface TicketCheckout {
  pass: ExhibitionPassView;
  checkout: {
    mode: 'widget' | 'redirect' | 'simulated';
    amountXof: number;
    reference: string;
    publicKey?: string;
    redirectUrl?: string;
    /** Widget en mode test : aucun argent réel ne bouge. */
    sandbox?: boolean;
  };
  /** Ce que le widget de paiement préremplit. */
  customer: { fullName: string; email: string; phone: string };
}

/**
 * Vérification d'un billet au retour du widget. `providerRef` est
 * l'identifiant de transaction appris par le navigateur : un confort, pas une
 * preuve — le serveur relit la transaction auprès du fournisseur.
 */
export const passVerifySchema = z
  .object({
    providerRef: z.string().trim().min(1).max(120).optional(),
  })
  /* Sans corps : simple relecture du billet, après un paiement par
     redirection ou au clic sur « J'ai payé ». */
  .default({});
export type PassVerifyInput = z.infer<typeof passVerifySchema>;

/** Fréquentation et ventes d'une exposition (§ 11.4 et 11.5). */
export interface ExhibitionStats {
  views: number;
  registrations: number;
  invitations: number;
  ticketsConfirmed: number;
  ticketsPending: number;
  ticketRevenueXof: number;
  /** Commandes payées contenant une œuvre exposée. */
  ordersCount: number;
  worksSold: number;
  salesXof: number;
}

export interface AdminPassView extends ExhibitionPassView {
  holderName: string;
  holderEmail: string;
}
