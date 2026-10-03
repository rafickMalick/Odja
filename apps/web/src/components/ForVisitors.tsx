"use client";

import type { ReactNode } from "react";

import { seesSignupCalls, useSession } from "@/lib/session";

/**
 * N'affiche son contenu qu'aux visiteurs (et à l'administrateur).
 *
 * Sert aux appels à créer un compte, dans des pages rendues côté serveur.
 * Le contenu est rendu tant que la session n'est pas connue : c'est ce que
 * reçoivent les moteurs de recherche et les visiteurs, de loin les plus
 * nombreux. Un compte connecté le voit disparaître à la première réponse.
 */
export function ForVisitors({
  children,
  fallback = null,
}: {
  children: ReactNode;
  /** Affiché à la place, pour un compte connecté. */
  fallback?: ReactNode;
}) {
  const { user, ready } = useSession();
  if (ready && !seesSignupCalls(user)) return <>{fallback}</>;
  return <>{children}</>;
}
