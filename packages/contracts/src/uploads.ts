import { z } from 'zod';

/**
 * Téléversement de fichiers.
 *
 * Les fichiers ne transitent **jamais par l'API** : elle signe une URL, le
 * navigateur envoie directement au stockage. Un octet de photo qui traverse le
 * serveur, c'est de la mémoire et de la bande passante consommées pour rien —
 * et un atelier qui envoie cinq photos de 8 Mo depuis un téléphone bloquerait
 * un processus entier.
 */

/** Ce à quoi le fichier sert. C'est l'usage qui décide s'il est public. */
export const uploadPurposeSchema = z.enum([
  /** Photo de fiche produit — visible de tous. */
  'product-image',
  /** Pièce justificative d'un créateur ou d'un livreur — administration seule. */
  'kyc-document',
  /** Photo prise par le livreur à la remise — pièce de litige. */
  'delivery-proof',
  /** Photo jointe à une réclamation. */
  'dispute-evidence',
  /** Logo ou bannière de boutique. */
  'shop-image',
  /** Capture ou photo jointe à une demande au service client. */
  'support-attachment',
  /** Affiche, photo du lieu ou d'une œuvre exposée — visible de tous. */
  'exhibition-image',
  /** Dossier de présentation, justificatif de propriété — administration seule. */
  'exhibition-document',
]);
export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

/**
 * Types acceptés et taille maximale, par usage.
 *
 * Les bornes ne sont pas décoratives : un téléphone récent produit des photos
 * de 6 à 10 Mo, et une pièce d'identité scannée dépasse rarement 5 Mo. Au-delà,
 * c'est une erreur de manipulation — ou une tentative de saturer le stockage.
 */
export const UPLOAD_RULES: Readonly<
  Record<UploadPurpose, { maxBytes: number; mimeTypes: readonly string[]; public: boolean }>
> = {
  'product-image': {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    public: true,
  },
  'shop-image': {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    public: true,
  },
  'kyc-document': {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    public: false,
  },
  'delivery-proof': {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    public: false,
  },
  'dispute-evidence': {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    public: false,
  },
  /* Privée : une capture d'écran de compte ou de paiement ne regarde que la
     personne et le service client. */
  'support-attachment': {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    public: false,
  },
  'exhibition-image': {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    public: true,
  },
  /* Un dossier d'exposition se transmet souvent en PDF de plusieurs pages,
     photos comprises : la borne est plus large que pour une pièce d'identité. */
  'exhibition-document': {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    public: false,
  },
};

export const requestUploadSchema = z.object({
  purpose: uploadPurposeSchema,
  contentType: z.string().trim().min(3).max(120),
  /** Taille annoncée. Elle est vérifiée avant de signer, et le stockage la
   *  refuse aussi à l'arrivée : une annonce mensongère ne passe pas. */
  sizeBytes: z.number().int().positive(),
  /** Nom d'origine, seulement pour retrouver le fichier à l'œil nu. */
  fileName: z.string().trim().max(200).optional(),
});
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export interface UploadTicket {
  /** URL à laquelle envoyer le fichier, en PUT, une seule fois. */
  uploadUrl: string;
  /** En-têtes à reproduire exactement, sinon la signature est rejetée. */
  headers: Record<string, string>;
  /** Identifiant du fichier, à renvoyer à l'API une fois l'envoi terminé. */
  fileKey: string;
  /** URL de lecture, seulement pour les fichiers publics. */
  publicUrl: string | null;
  expiresInSeconds: number;
}

/** Rattachement d'une photo à une fiche produit, une fois l'envoi terminé. */
export const attachProductImageSchema = z.object({
  fileKey: z.string().trim().min(1),
  alt: z.string().trim().max(200).optional(),
});
export type AttachProductImageInput = z.infer<typeof attachProductImageSchema>;

export const reorderProductImagesSchema = z.object({
  /** Identifiants des images, dans l'ordre voulu. */
  imageIds: z.array(z.string().min(1)).min(1).max(5),
});

export const attachKycDocumentSchema = z.object({
  fileKey: z.string().trim().min(1),
  type: z.enum([
    'cni_recto',
    'cni_verso',
    'rccm',
    'ifu',
    'permis',
    'carte_grise',
    /** Carte d'étudiant, certificat de scolarité, attestation d'apprentissage. */
    'justificatif_formation',
    'autre',
  ]),
});
export type AttachKycDocumentInput = z.infer<typeof attachKycDocumentSchema>;

export interface ProductImageView {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface KycDocumentView {
  id: string;
  type: string;
  status: string;
  note: string | null;
  createdAt: string;
  /** URL de lecture à durée courte. Absente hors administration. */
  url?: string;
}
