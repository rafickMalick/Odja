/**
 * Preuve de livraison.
 *
 * Elle ne déclenche plus le paiement — c'est la validation du client qui le
 * fait (SPEC-ALIGNEMENT § 2) — mais elle reste la pièce qui tranche un litige
 * « je n'ai rien reçu ». Sans elle, c'est parole contre parole, et Ojà paie.
 *
 * **Le code du client suffit à lui seul** : il n'est affiché que dans sa
 * commande et ne sort de sa poche qu'une fois la pièce en main. Le livreur le
 * tape sur son téléphone, et la remise est confirmée.
 *
 * Sans code (client injoignable, pas de réseau), **photo + position** prennent
 * le relais. Une photo seule ou une position seule ne suffisent pas : trop
 * faciles à fabriquer.
 *
 * Localisation en pause (`gpsEnabled: false`) : la position est ignorée, et
 * sans code la photo suffit — il ne reste qu'elle.
 */

export type ProofElement = 'otp' | 'photo' | 'gps';

/** Éléments exigés quand le client n'a pas donné son code. */
export const REQUIRED_PROOF_ELEMENTS = 2;

/** Rayon au-delà duquel le point de livraison ne correspond plus à l'adresse. */
export const GPS_TOLERANCE_METERS = 300;

export interface ProofSubmission {
  /** Code à quatre chiffres remis au client, saisi par le livreur. */
  otp?: string | undefined;
  photoKey?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface ProofContext {
  expectedOtp: string;
  /** Localisation active ? Sinon la position n'est ni demandée ni comptée. */
  gpsEnabled?: boolean | undefined;
  /** Position de l'adresse de livraison, si le client l'a renseignée. */
  destination?: { latitude: number; longitude: number } | undefined;
  distanceMeters?: ((a: { latitude: number; longitude: number }) => number) | undefined;
}

export interface ProofAssessment {
  accepted: boolean;
  /** Éléments effectivement apportés et valides. */
  provided: ProofElement[];
  /** Ce qui manque pour atteindre le seuil, en clair pour le livreur. */
  problems: string[];
}

export class ProofOfDeliveryError extends Error {}

/**
 * Évalue une preuve de livraison.
 *
 * Renvoie l'inventaire de ce qui est acquis et de ce qui manque, plutôt qu'un
 * simple refus : un livreur qui reçoit « preuve insuffisante » sans savoir
 * quoi ajouter reste planté devant la porte.
 */
export function assessProof(
  submission: ProofSubmission,
  context: ProofContext,
  toleranceMeters = GPS_TOLERANCE_METERS,
): ProofAssessment {
  const provided: ProofElement[] = [];
  const problems: string[] = [];

  // ── Code de réception ──
  if (submission.otp) {
    if (constantTimeEquals(submission.otp, context.expectedOtp)) {
      provided.push('otp');
    } else {
      problems.push('Le code communiqué par le client ne correspond pas.');
    }
  } else {
    problems.push('Demandez au client le code à quatre chiffres qu’il a reçu.');
  }

  // ── Photo ──
  if (submission.photoKey) {
    provided.push('photo');
  } else {
    problems.push('Prenez une photo du colis remis.');
  }

  // ── Position ──
  const gpsEnabled = context.gpsEnabled ?? true;
  if (!gpsEnabled) {
    // En pause : ni comptée, ni réclamée au livreur.
  } else if (submission.latitude !== undefined && submission.longitude !== undefined) {
    const here = { latitude: submission.latitude, longitude: submission.longitude };

    if (!context.destination || !context.distanceMeters) {
      /* Le client n'a pas posé de point GPS : on ne peut rien comparer. La
         position est enregistrée comme trace, mais ne compte pas comme
         preuve — sinon n'importe quelle position vaudrait preuve. */
      problems.push(
        'Position enregistrée, mais l’adresse du client n’a pas de point GPS à comparer.',
      );
    } else if (context.distanceMeters(here) <= toleranceMeters) {
      provided.push('gps');
    } else {
      problems.push(
        `Vous êtes à plus de ${toleranceMeters} m de l’adresse de livraison.`,
      );
    }
  } else {
    problems.push('Activez la localisation au moment de la remise.');
  }

  const required = gpsEnabled ? REQUIRED_PROOF_ELEMENTS : 1;
  const accepted = provided.includes('otp') || provided.length >= required;

  return {
    accepted,
    provided,
    // Une preuve acceptée n'a plus de manque à signaler : les éléments
    // absents ne sont plus des problèmes.
    problems: accepted ? [] : problems,
  };
}

/**
 * Code de réception à quatre chiffres.
 *
 * Quatre et non six : le client le lit à voix haute au livreur, sur le pas de
 * sa porte. Sa courte durée de vie et son usage unique compensent le moindre
 * espace de recherche.
 */
export function formatDeliveryOtp(value: number): string {
  return String(Math.abs(Math.trunc(value)) % 10_000).padStart(4, '0');
}

/**
 * Comparaison à temps constant.
 *
 * Un code à quatre chiffres se devine en 10 000 essais ; inutile d'offrir en
 * plus la fuite d'information qu'apporte une comparaison qui s'arrête au
 * premier caractère différent.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
