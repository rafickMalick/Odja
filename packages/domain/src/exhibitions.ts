/**
 * Expositions (cahier des évolutions, § 6 à 9).
 *
 * Une exposition suit un circuit d'instruction : l'organisateur soumet,
 * l'administration examine, demande des modifications ou accepte ; le contrat
 * est signé, le paiement reçu, la mise en ligne programmée. Ces règles vivent
 * ici, sans dépendance, pour être testées seules et partagées par l'API.
 */

export type ExhibitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'ACCEPTED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'SUSPENDED';

export type ExhibitionFormat = 'PHYSICAL' | 'ONLINE' | 'HYBRID';
export type ExhibitionAccess = 'FREE' | 'PAID' | 'RESTRICTED';

export const EXHIBITION_STATUS_LABELS: Readonly<Record<ExhibitionStatus, string>> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'En examen',
  CHANGES_REQUESTED: 'Modifications demandées',
  REJECTED: 'Refusée',
  ACCEPTED: 'Acceptée — contrat et paiement',
  SCHEDULED: 'Programmée',
  PUBLISHED: 'En ligne',
  SUSPENDED: 'Suspendue',
};

const GRAPH: Readonly<Record<ExhibitionStatus, readonly ExhibitionStatus[]>> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['CHANGES_REQUESTED', 'REJECTED', 'ACCEPTED'],
  CHANGES_REQUESTED: ['SUBMITTED'],
  // Un refus est définitif : l'organisateur dépose un nouveau projet.
  REJECTED: [],
  ACCEPTED: ['SCHEDULED', 'REJECTED'],
  SCHEDULED: ['PUBLISHED', 'SUSPENDED'],
  PUBLISHED: ['SUSPENDED'],
  SUSPENDED: ['PUBLISHED'],
};

export class ExhibitionTransitionError extends Error {
  constructor(
    readonly from: ExhibitionStatus,
    readonly to: ExhibitionStatus,
  ) {
    super(
      `Une exposition « ${EXHIBITION_STATUS_LABELS[from]} » ne peut pas passer à « ${EXHIBITION_STATUS_LABELS[to]} ».`,
    );
  }
}

export function assertExhibitionTransition(from: ExhibitionStatus, to: ExhibitionStatus): void {
  if (!GRAPH[from].includes(to)) throw new ExhibitionTransitionError(from, to);
}

/** L'organisateur ne modifie son dossier que tant qu'il n'est pas instruit. */
export function isEditableByOrganizer(status: ExhibitionStatus): boolean {
  return status === 'DRAFT' || status === 'CHANGES_REQUESTED';
}

/**
 * Une exposition est visible du public une fois en ligne, ou programmée et
 * arrivée à sa date de mise en ligne. Ce second cas évite qu'une exposition
 * reste cachée parce que personne n'a cliqué « publier » le bon matin.
 */
export function isPubliclyVisible(
  exhibition: { status: ExhibitionStatus; publishAt: Date | null },
  now: Date,
): boolean {
  if (exhibition.status === 'PUBLISHED') return true;
  return (
    exhibition.status === 'SCHEDULED' && exhibition.publishAt !== null && exhibition.publishAt <= now
  );
}

export type ExhibitionPeriod = 'UPCOMING' | 'ONGOING' | 'ENDED';

export function exhibitionPeriod(
  exhibition: { startsAt: Date; endsAt: Date },
  now: Date,
): ExhibitionPeriod {
  if (now < exhibition.startsAt) return 'UPCOMING';
  if (now > exhibition.endsAt) return 'ENDED';
  return 'ONGOING';
}

export interface ExhibitionDraft {
  title: string;
  summary: string;
  startsAt: Date;
  endsAt: Date;
  format: ExhibitionFormat;
  venueName: string | null;
  venueAddress: string | null;
  accessMode: ExhibitionAccess;
  ticketPriceXof: number;
  hasAccessCode: boolean;
  planId: string | null;
}

export interface PlanLimits {
  name: string;
  maxWorks: number | null;
  maxDurationDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ce qui manque pour soumettre le dossier, tout à la fois.
 *
 * Les limites viennent de la formule choisie : le cahier veut des formules
 * paramétrables, pas des plafonds écrits dans le code (§ 6.6).
 */
export function whyExhibitionNotSubmittable(
  draft: ExhibitionDraft,
  workCount: number,
  plan: PlanLimits | null,
): string[] {
  const problems: string[] = [];

  if (draft.endsAt <= draft.startsAt) {
    problems.push('La date de fin doit suivre la date de début.');
  }
  if (draft.format !== 'ONLINE' && (!draft.venueName || !draft.venueAddress)) {
    problems.push('Une exposition sur place doit indiquer le nom et l’adresse du lieu.');
  }
  if (workCount === 0) problems.push('Ajoutez au moins une œuvre.');
  if (!plan) problems.push('Choisissez une formule.');

  if (plan) {
    if (plan.maxWorks !== null && workCount > plan.maxWorks) {
      problems.push(`La formule ${plan.name} accueille ${plan.maxWorks} œuvres au plus (${workCount} pour l’instant).`);
    }
    const days = Math.ceil((draft.endsAt.getTime() - draft.startsAt.getTime()) / DAY_MS);
    if (plan.maxDurationDays !== null && days > plan.maxDurationDays) {
      problems.push(`La formule ${plan.name} couvre ${plan.maxDurationDays} jours au plus (${days} demandés).`);
    }
  }

  if (draft.accessMode === 'PAID' && draft.ticketPriceXof <= 0) {
    problems.push('Indiquez le prix du billet d’une exposition payante.');
  }
  if (draft.accessMode === 'RESTRICTED' && !draft.hasAccessCode) {
    problems.push('Choisissez le code d’accès d’une exposition réservée.');
  }

  return problems;
}

/**
 * Peut-on programmer la mise en ligne ? Seulement contrat signé et paiement
 * reçu (§ 6.4, étapes 7 et 8). Renvoie ce qui manque.
 */
export function whyNotSchedulable(exhibition: {
  contractSignedAt: Date | null;
  paymentReceivedAt: Date | null;
  priceXof: number;
}): string[] {
  const missing: string[] = [];
  if (!exhibition.contractSignedAt) missing.push('le contrat signé');
  /* Une formule gratuite n'attend pas de paiement. */
  if (exhibition.priceXof > 0 && !exhibition.paymentReceivedAt) missing.push('le paiement de la formule');
  return missing;
}

// ═══════════════════════════════════════════ Accès aux contenus (§ 8)

export interface AccessSettings {
  accessMode: ExhibitionAccess;
  requiresRegistration: boolean;
}

/**
 * Ce que le visiteur doit faire avant de voir la galerie.
 *
 * - `OPEN` : rien, la galerie s'affiche ;
 * - `REGISTER` : une inscription gratuite ;
 * - `TICKET` : un billet payé ;
 * - `CODE` : le code d'accès de l'organisateur.
 */
export type AccessRequirement = 'OPEN' | 'REGISTER' | 'TICKET' | 'CODE';

export function accessRequirement(settings: AccessSettings): AccessRequirement {
  if (settings.accessMode === 'PAID') return 'TICKET';
  if (settings.accessMode === 'RESTRICTED') return 'CODE';
  return settings.requiresRegistration ? 'REGISTER' : 'OPEN';
}

/**
 * Le visiteur peut-il voir les contenus réservés ?
 *
 * L'organisateur et l'administration voient toujours tout : ils doivent
 * pouvoir vérifier ce qui est publié.
 */
export function canSeeContent(
  settings: AccessSettings,
  viewer: { hasConfirmedPass: boolean; isOrganizerOrAdmin: boolean },
): boolean {
  if (viewer.isOrganizerOrAdmin) return true;
  return accessRequirement(settings) === 'OPEN' || viewer.hasConfirmedPass;
}
