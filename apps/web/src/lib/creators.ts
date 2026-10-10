import type {
  CreatorKind,
  DisplayAvailability,
  MakerCard,
  MakerWork,
  Page,
} from "@oja/contracts";

import { apiFetchOrNull } from "./api";

/**
 * Profils créatifs : libellés et lectures publiques.
 *
 * Le statut dit ce qu'est le créateur ; le badge, ce qu'il a acheté comme
 * visibilité. Les deux s'affichent séparément et ne se mélangent jamais
 * (cahier des évolutions, § 3.1).
 */

export const CREATOR_KIND_LABELS: Record<CreatorKind, string> = {
  STUDIO: "Entreprise ou studio créatif",
  ARTISAN: "Artisan",
  DESIGNER: "Designer indépendant",
  APPRENTICE_DESIGNER: "Apprenti designer",
  APPRENTICE_ARTISAN: "Apprenti artisan",
};

/** Libellé court, pour les cartes et les filtres. */
export const CREATOR_KIND_SHORT: Record<CreatorKind, string> = {
  STUDIO: "Studio",
  ARTISAN: "Artisan",
  DESIGNER: "Designer",
  APPRENTICE_DESIGNER: "Apprenti designer",
  APPRENTICE_ARTISAN: "Apprenti artisan",
};

/** Dans l'ordre du cahier (§ 4.2). Les apprentis justifient de leur formation. */
export const CREATOR_KINDS: CreatorKind[] = [
  "STUDIO",
  "ARTISAN",
  "DESIGNER",
  "APPRENTICE_DESIGNER",
  "APPRENTICE_ARTISAN",
];

export function isApprenticeKind(kind: string | undefined | null): boolean {
  return kind === "APPRENTICE_DESIGNER" || kind === "APPRENTICE_ARTISAN";
}

export const AVAILABILITY_LABELS: Record<DisplayAvailability, string> = {
  AVAILABLE: "Disponible",
  MADE_TO_ORDER: "Sur commande",
  SOLD: "Vendu",
  UNAVAILABLE: "Indisponible",
  PORTFOLIO: "Réalisation",
};

const TTL = 60;

export async function fetchMakerWorks(slug: string): Promise<MakerWork[]> {
  const works = await apiFetchOrNull<MakerWork[]>(
    `/makers/${encodeURIComponent(slug)}/works`,
    { revalidate: TTL },
  );
  return works ?? [];
}

export interface DirectoryFilters {
  q?: string | undefined;
  kind?: string | undefined;
  city?: string | undefined;
  cursor?: string | undefined;
}

export async function fetchDirectory(filters: DirectoryFilters): Promise<Page<MakerCard>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  const page = await apiFetchOrNull<Page<MakerCard>>(`/makers${suffix ? `?${suffix}` : ""}`, {
    revalidate: TTL,
  });
  return page ?? { items: [], nextCursor: null };
}
