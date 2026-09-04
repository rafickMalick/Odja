import { z } from 'zod';

/**
 * Contrats de l'espace livreur.
 *
 * Le livreur est le seul profil dont le travail se fait **dehors**, sur un
 * téléphone, souvent avec un réseau incertain. Les contrats en tiennent
 * compte : les positions sont facultatives partout où elles ne conditionnent
 * pas une décision d'argent, et la preuve de remise accepte plusieurs
 * combinaisons plutôt qu'une seule.
 */

const trimmed = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} : ${min} caractères au minimum`).max(max);

export const vehicleTypeSchema = z.enum(['MOTO', 'TRICYCLE', 'CAMIONNETTE']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

/** Libellés d'affichage, tenus ici pour ne pas diverger d'un écran à l'autre. */
export const VEHICLE_LABELS: Record<VehicleType, string> = {
  MOTO: 'Moto',
  TRICYCLE: 'Tricycle',
  CAMIONNETTE: 'Camionnette',
};

export const courierProfileSchema = z.object({
  vehicle: vehicleTypeSchema,
  /** Obligatoire : c'est ce que l'atelier et le client voient arriver. */
  plateNumber: trimmed(3, 20, "Numéro d'immatriculation"),
  /** Numéro Mobile Money sur lequel les gains sont versés. */
  payoutMsisdn: z.string().trim().min(8).max(20).optional(),
  payoutOperator: z.string().trim().max(40).optional(),
});
export type CourierProfileInput = z.infer<typeof courierProfileSchema>;

export const courierProfileUpdateSchema = courierProfileSchema.partial();
export type CourierProfileUpdateInput = z.infer<typeof courierProfileUpdateSchema>;

export interface CourierProfileView {
  id: string;
  userId: string;
  fullName: string;
  vehicle: VehicleType;
  plateNumber: string | null;
  payoutMsisdn: string | null;
  payoutOperator: string | null;
  isAvailable: boolean;
  ratingAvg: number;
  kycStatus: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  kycSubmittedAt: string | null;
  kycRejectReason: string | null;
  /** Nombre de courses menées à leur terme. */
  deliveredCount: number;
}

/**
 * Gains du livreur.
 *
 * Tant que la règle de rémunération n'est pas arrêtée (SPEC-ALIGNEMENT § 9,
 * point F), la totalité des frais de livraison lui est provisionnée. L'écran
 * le dit plutôt que de laisser croire à un montant définitif.
 */
export interface CourierEarnings {
  /**
   * Frais de livraison encaissés sur ses courses livrées.
   *
   * Ce **n'est pas** son gain : la provision de livraison est collective au
   * grand livre (compte de plateforme, sans propriétaire), et le partage entre
   * la course et la marge d'Ojà attend l'arbitrage du § 9-F. C'est en revanche
   * l'assiette sur laquelle le futur barème s'appliquera — un chiffre vrai,
   * là où un « dû » nominatif serait inventé.
   */
  deliveryFeesCollectedXof: number;
  scheduledXof: number;
  readyXof: number;
  paidXof: number;
  deliveredCount: number;
  items: {
    id: string;
    amountXof: number;
    status: string;
    shipmentReference: string | null;
    releaseAt: string | null;
    paidAt: string | null;
    createdAt: string;
  }[];
}

// ═══════════════════════════════════════════ Suivi de livraison (F1-07)

export const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type PositionInput = z.infer<typeof positionSchema>;

/** Une étape du parcours, ou un point de position pendant le trajet. */
export interface ShipmentTrackEvent {
  status: string;
  statusLabel: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  at: string;
}

/**
 * Instantané renvoyé par `GET /shipments/:reference/track`, et premier message
 * du flux SSE `GET /shipments/:reference/stream`.
 */
export interface ShipmentTrackView {
  reference: string;
  status: string;
  statusLabel: string;
  etaAt: string | null;
  lastPosition: { latitude: number; longitude: number; at: string } | null;
  events: ShipmentTrackEvent[];
}
