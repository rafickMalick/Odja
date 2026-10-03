import { z } from 'zod';

/**
 * Contrats du catalogue et des profils créateurs.
 *
 * Le cahier client sépare explicitement, pour une entreprise, ce qui est
 * **public** de ce qui reste à l'administration. Cette frontière est portée
 * ici par deux types distincts, `PublicMaker` et `AdminMaker` — pas par une
 * consigne dans une revue de code.
 */

const trimmed = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} : ${min} caractères au minimum`).max(max);

// ═══════════════════════════════════════════ Profil créateur

/** Ce que le créateur renseigne à la création de sa boutique. */
export const makerProfileSchema = z.object({
  // Informations publiques
  shopName: trimmed(2, 120, "Nom de l'entreprise"),
  description: z.string().trim().max(2_000).optional(),
  cityId: z.string().min(1, 'Ville requise'),

  // Informations privées — administration uniquement
  managerName: trimmed(2, 120, 'Nom du responsable'),
  contactPhone: z.string().trim().min(8).max(20),
  contactEmail: z.string().trim().toLowerCase().email(),
  postalAddress: trimmed(4, 300, 'Adresse physique'),
  ifuNumber: z.string().trim().max(40).optional(),
  rccmNumber: z.string().trim().max(40).optional(),

  // Adresse d'enlèvement : c'est là que le livreur se présente. Elle est
  // distincte de l'adresse postale — l'atelier n'est pas toujours au siège.
  pickupLine1: trimmed(4, 300, "Adresse de l'atelier"),
  pickupLandmark: z.string().trim().max(200).optional(),
  pickupLatitude: z.number().min(-90).max(90).optional(),
  pickupLongitude: z.number().min(-180).max(180).optional(),
});
export type MakerProfileInput = z.infer<typeof makerProfileSchema>;

export const makerProfileUpdateSchema = makerProfileSchema.partial();
export type MakerProfileUpdateInput = z.infer<typeof makerProfileUpdateSchema>;

/**
 * Vue publique d'un atelier. **Aucun champ privé ne doit apparaître ici** :
 * ni téléphone, ni e-mail, ni adresse, ni IFU, ni RCCM. C'est la règle métier
 * du cahier — Ojà reste l'intermédiaire unique.
 */
export interface PublicMaker {
  id: string;
  slug: string;
  shopName: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string;
  country: string;
  ratingAvg: number;
  ratingCount: number;
  productCount: number;
}

/** Vue administrateur : tout, y compris ce qui ne sort jamais côté client. */
export interface AdminMaker extends PublicMaker {
  userId: string;
  managerName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  ifuNumber: string | null;
  rccmNumber: string | null;
  kycStatus: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  kycSubmittedAt: string | null;
  kycReviewedAt: string | null;
  kycRejectReason: string | null;
  commissionBps: number;
}

/**
 * Ce qu'un créateur voit de **sa propre** boutique.
 *
 * La vue administrateur ne rend que des libellés — « Cotonou », pas
 * l'identifiant de la ville — et tait l'adresse d'enlèvement. C'est le bon
 * choix pour une liste de dossiers à valider ; c'est insuffisant pour rééditer
 * son propre formulaire, qui a besoin des valeurs brutes.
 */
export interface OwnMakerProfile extends AdminMaker {
  cityId: string;
  pickupLine1: string | null;
  pickupLandmark: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
}

export const kycReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});
export type KycReviewInput = z.infer<typeof kycReviewSchema>;

// ═══════════════════════════════════════════ Produits

/* Bornes hautes : les colonnes sont des entiers 32 bits en base. Sans plafond,
   une saisie démesurée passe la validation puis fait échouer l'écriture (500
   au lieu d'un message clair au créateur). */
const MAX_QUANTITY = 100_000;
const MAX_WEIGHT_GRAMS = 2_000_000;
const MAX_DIMENSION_MM = 20_000;

/**
 * Poids et dimensions sont **obligatoires**. Le cahier client ne les demande
 * pas dans son formulaire, mais le choix automatique du véhicule de livraison
 * en dépend entièrement : sans eux, aucune commande ne peut être chiffrée
 * (SPEC-ALIGNEMENT § 9, point B).
 */
export const productSchema = z
  .object({
    name: trimmed(3, 160, 'Nom du produit'),
    categoryId: z.string().min(1, 'Catégorie requise'),
    description: trimmed(20, 5_000, 'Description'),
    material: z.string().trim().max(120).optional(),

    /** Le prix que vous fixez et que vous toucherez en entier. */
    makerPriceXof: z
      .number()
      .int('Le prix doit être un nombre entier de francs')
      .positive('Le prix doit être supérieur à zéro')
      .max(100_000_000),

    isMadeToOrder: z.boolean().default(false),
    quantityAvailable: z.number().int().min(0).max(MAX_QUANTITY, 'Quantité trop élevée').default(0),
    leadTimeDays: z.number().int().positive().max(365).optional(),
    observations: z.string().trim().max(1_000).optional(),

    weightGrams: z
      .number()
      .int()
      .positive('Le poids est nécessaire au calcul de livraison')
      .max(MAX_WEIGHT_GRAMS, 'Poids trop élevé (2 tonnes au maximum)'),
    lengthMm: z
      .number()
      .int()
      .positive('Les dimensions sont nécessaires au calcul de livraison')
      .max(MAX_DIMENSION_MM, 'Dimension trop grande (20 m au maximum)'),
    widthMm: z.number().int().positive().max(MAX_DIMENSION_MM, 'Dimension trop grande (20 m au maximum)'),
    heightMm: z.number().int().positive().max(MAX_DIMENSION_MM, 'Dimension trop grande (20 m au maximum)'),
  })
  .refine((p) => !p.isMadeToOrder || p.leadTimeDays !== undefined, {
    path: ['leadTimeDays'],
    message: 'Une pièce fabriquée sur commande doit annoncer son délai',
  });
export type ProductInput = z.infer<typeof productSchema>;

export const productUpdateSchema = productSchema.innerType().partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const stockUpdateSchema = z.object({
  quantityAvailable: z.number().int().min(0).max(MAX_QUANTITY, 'Quantité trop élevée'),
});

export const productReviewSchema = z.object({
  decision: z.enum(['PUBLISH', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});
export type ProductReviewInput = z.infer<typeof productReviewSchema>;

/**
 * Fiche produit telle que le client la voit.
 *
 * Un seul prix : `finalPriceXof`, celui affiché et payé, commission Ojà
 * comprise. Le détail prix créateur / marge de la plateforme reste au
 * back-office — le client n'a pas à voir la marge d'Ojà.
 */
export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  material: string | null;
  category: { id: string; slug: string; name: string };
  maker: { id: string; slug: string; shopName: string; city: string };
  images: { url: string; alt: string | null }[];

  /** Le prix affiché et payé, commission Ojà comprise. */
  finalPriceXof: number;

  isMadeToOrder: boolean;
  leadTimeDays: number | null;
  quantityAvailable: number;
  inStock: boolean;

  /** Encombrement, en millimètres et grammes. Sur du mobilier, un acheteur a
   *  besoin de savoir si la pièce passe la porte. */
  dimensions: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    weightGrams: number;
  };

  ratingAvg: number;
  ratingCount: number;
}

// ═══════════════════════════════════════════ Recherche

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().optional(),
  maker: z.string().trim().optional(),
  city: z.string().trim().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  /* Pas de `z.coerce.boolean()` : il applique `Boolean()`, et
     `Boolean("false")` vaut `true` — `?inStock=false` filtrerait donc sur
     « en stock ». On lit la chaîne pour ce qu'elle dit. */
  inStock: z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')
    .optional(),
  sort: z.enum(['relevance', 'recent', 'price_asc', 'price_desc', 'rating']).default('recent'),
  /* Pagination par curseur, jamais par OFFSET : au-delà de quelques milliers
     de lignes, PostgreSQL relit tout ce qu'il saute. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

// ═══════════════════════════════════════════ Catégories

export const categorySchema = z.object({
  name: trimmed(2, 80, 'Nom'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Identifiant en minuscules, chiffres et tirets uniquement'),
  parentId: z.string().optional(),
  position: z.number().int().min(0).default(0),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  position: number;
  productCount: number;
  children: PublicCategory[];
}
