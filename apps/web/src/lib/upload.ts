import { formatNumber } from "./format";
import { apiFetch } from "./api";

/**
 * Envoi d'un fichier au stockage, en trois temps.
 *
 * L'API ne voit jamais l'octet : elle signe une autorisation, le navigateur
 * met le fichier directement sur le stockage, puis on rattache la clé obtenue
 * à la fiche concernée. Le troisième temps appartient à l'appelant  c'est lui
 * qui sait s'il s'agit d'une photo produit ou d'une pièce justificative.
 */

export type UploadPurpose =
  | "product-image"
  | "shop-image"
  | "kyc-document"
  | "delivery-proof"
  | "dispute-evidence"
  | "support-attachment";

interface UploadTicket {
  uploadUrl: string;
  headers: Record<string, string>;
  fileKey: string;
  publicUrl: string | null;
  expiresInSeconds: number;
}

/** Bornes reprises du contrat, pour refuser sur place plutôt qu'aller-retour. */
const RULES: Record<UploadPurpose, { maxBytes: number; mimeTypes: string[] }> = {
  "product-image": {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  "shop-image": {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
  },
  "kyc-document": {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
  "delivery-proof": {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  "dispute-evidence": {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
  "support-attachment": {
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
};

export class UploadError extends Error {}

/**
 * Retourne la clé du fichier envoyé.
 *
 * Les bornes sont vérifiées avant de demander l'autorisation : refuser une
 * photo de 30 Mo après l'avoir laissée monter sur un réseau mobile, c'est
 * faire perdre plusieurs minutes pour rien.
 */
export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
): Promise<{ fileKey: string; publicUrl: string | null }> {
  const rule = RULES[purpose];

  if (!rule.mimeTypes.includes(file.type)) {
    throw new UploadError(
      `Format non accepté. Envoyez un fichier ${rule.mimeTypes
        .map((type) => type.replace(/^.*\//, "").toUpperCase())
        .join(", ")}.`,
    );
  }
  if (file.size > rule.maxBytes) {
    throw new UploadError(
      `Fichier trop lourd (${mb(file.size)} Mo). Maximum ${mb(rule.maxBytes)} Mo.`,
    );
  }

  const ticket = await apiFetch<UploadTicket>("/uploads/ticket", {
    method: "POST",
    body: {
      purpose,
      contentType: file.type,
      sizeBytes: file.size,
      fileName: file.name,
    },
  });

  /* Les en-têtes de l'autorisation sont reproduits tels quels : la taille est
     signée, une valeur différente invalide la signature. */
  const response = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.headers,
    body: file,
  });

  if (!response.ok) {
    throw new UploadError("L'envoi du fichier a échoué. Réessayez.");
  }

  return { fileKey: ticket.fileKey, publicUrl: ticket.publicUrl };
}

function mb(bytes: number): string {
  // « 5 », « 2,5 » : une décimale seulement quand elle compte.
  const rounded = Math.round((bytes / 1024 / 1024) * 10) / 10;
  return formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1);
}
