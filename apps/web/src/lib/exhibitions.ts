import type {
  ExhibitionAccessMode,
  ExhibitionCard,
  ExhibitionFormat,
  ExhibitionPeriod,
  ExhibitionPlanView,
  ExhibitionStatus,
  PublicExhibition,
} from "@oja/contracts";

import { apiFetchOrNull } from "./api";
import { formatFcfa } from "./format";

/**
 * Expositions : libellés et lectures publiques.
 *
 * Les lectures serveur ne portent pas la session du visiteur : la galerie
 * d'une exposition réservée se recharge donc dans le navigateur, où le cookie
 * de session accompagne la requête.
 */

export const FORMAT_LABELS: Record<ExhibitionFormat, string> = {
  PHYSICAL: "Sur place",
  ONLINE: "En ligne",
  HYBRID: "Sur place et en ligne",
};

export const PERIOD_LABELS: Record<ExhibitionPeriod, string> = {
  UPCOMING: "À venir",
  ONGOING: "En cours",
  ENDED: "Terminée",
};

export const ACCESS_LABELS: Record<ExhibitionAccessMode, string> = {
  FREE: "Accès libre",
  PAID: "Accès payant",
  RESTRICTED: "Sur invitation",
};

export const STATUS_LABELS: Record<ExhibitionStatus, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "En examen",
  CHANGES_REQUESTED: "Modifications demandées",
  REJECTED: "Refusée",
  ACCEPTED: "Acceptée — contrat et paiement",
  SCHEDULED: "Programmée",
  PUBLISHED: "En ligne",
  SUSPENDED: "Suspendue",
};

export const STATUS_TONE: Record<ExhibitionStatus, "pending" | "success" | "info" | "warning" | "danger"> = {
  DRAFT: "pending",
  SUBMITTED: "info",
  CHANGES_REQUESTED: "warning",
  REJECTED: "danger",
  ACCEPTED: "info",
  SCHEDULED: "info",
  PUBLISHED: "success",
  SUSPENDED: "danger",
};

export function accessLabel(card: Pick<ExhibitionCard, "accessMode" | "ticketPriceXof">): string {
  return card.accessMode === "PAID"
    ? `Billet ${formatFcfa(card.ticketPriceXof)}`
    : ACCESS_LABELS[card.accessMode];
}

/** « du 3 au 20 novembre 2026 », ou « du 28 octobre au 4 novembre 2026 ». */
export function dateRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("fr-FR", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "long" }),
  });
  const endLabel = end.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `du ${startLabel} au ${endLabel}`;
}

const TTL = 60;

export async function fetchExhibitions(filters: {
  when?: string | undefined;
  access?: string | undefined;
  featured?: boolean | undefined;
}): Promise<ExhibitionCard[]> {
  const query = new URLSearchParams();
  if (filters.when) query.set("when", filters.when);
  if (filters.access) query.set("access", filters.access);
  if (filters.featured) query.set("featured", "1");
  const suffix = query.toString();
  return (
    (await apiFetchOrNull<ExhibitionCard[]>(`/exhibitions${suffix ? `?${suffix}` : ""}`, {
      revalidate: TTL,
    })) ?? []
  );
}

export async function fetchExhibition(slug: string): Promise<PublicExhibition | null> {
  return apiFetchOrNull<PublicExhibition>(`/exhibitions/${encodeURIComponent(slug)}`, {
    revalidate: 0,
  });
}

export async function fetchExhibitionPlans(): Promise<ExhibitionPlanView[]> {
  return (await apiFetchOrNull<ExhibitionPlanView[]>("/exhibitions/plans", { revalidate: TTL })) ?? [];
}
