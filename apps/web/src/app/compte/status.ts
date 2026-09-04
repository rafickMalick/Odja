import type { BadgeType } from "@/components/Badge";

/**
 * Teintes des états, tenues en un seul endroit.
 *
 * Dispersées dans chaque écran, elles divergent : la même commande finit
 * orange sur une page et verte sur l'autre, et le client ne sait plus ce qu'il
 * doit croire.
 */

export const ORDER_TONE: Record<string, BadgeType> = {
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  IN_PRODUCTION: "info",
  PREPARING: "info",
  IN_DELIVERY: "info",
  DELIVERED: "warning",
  VALIDATED: "success",
  COMPLETED: "success",
  DISPUTED: "danger",
  CANCELLED: "danger",
  REFUNDED: "danger",
};

export const SUB_ORDER_TONE: Record<string, BadgeType> = {
  RECEIVED: "pending",
  PAYMENT_CONFIRMED: "pending",
  IN_PRODUCTION: "info",
  READY_FOR_PICKUP: "info",
  IN_DELIVERY: "info",
  /* « Livré » est en orange, pas en vert : le colis est arrivé mais rien n'est
     fini tant que le client n'a pas confirmé. Le vert signalerait le contraire. */
  DELIVERED: "warning",
  VALIDATED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
};

export const DISPUTE_TONE: Record<string, BadgeType> = {
  OPEN: "warning",
  UNDER_REVIEW: "info",
  RESOLVED: "success",
  REJECTED: "danger",
};
