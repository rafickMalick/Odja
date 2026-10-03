"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { apiFetchOrNull } from "./api";
import { homeForRole } from "./home-for-role";

/**
 * Qui est connecté, pour les pages publiques.
 *
 * Une seule requête `/auth/me` partagée : l'en-tête, le pied de page et les
 * appels à s'inscrire en ont tous besoin, et chacun la refaisait de son côté.
 *
 * Relue à chaque changement de page : la connexion et la déconnexion se
 * terminent par une navigation, et le fournisseur, posé dans la mise en page,
 * ne se démonte jamais. Lue une seule fois, la session garderait « visiteur »
 * après la connexion jusqu'au prochain rechargement.
 */

export interface SessionUser {
  role: string;
  firstName: string;
}

interface SessionState {
  user: SessionUser | null;
  /** Faux tant que la première réponse n'est pas arrivée. */
  ready: boolean;
}

const SessionContext = createContext<SessionState>({ user: null, ready: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<SessionState>({ user: null, ready: false });

  useEffect(() => {
    let cancelled = false;
    void apiFetchOrNull<SessionUser>("/auth/me").then((user) => {
      if (!cancelled) setState({ user, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * Les appels à créer un compte (« Vendre sur Ojà », « Devenir livreur »…)
 * ne s'adressent qu'aux visiteurs : sur Ojà, un compte porte un seul rôle, et
 * un client connecté ne peut pas devenir créateur sans un second compte.
 *
 * L'administrateur fait exception : il voit le site public tel qu'un visiteur
 * le voit, pour pouvoir le contrôler.
 */
export function seesSignupCalls(user: SessionUser | null): boolean {
  return !user || user.role === "ADMIN";
}

/**
 * Connexion et inscription n'ont rien à offrir à un compte déjà connecté : on
 * le renvoie dans son espace (l'administrateur, lui, reste libre).
 *
 * Jamais vers la page d'origine (`?suite=`) : un client renvoyé de `/admin`
 * vers la connexion y retournerait, et tournerait en boucle.
 */
export function useRedirectSignedIn(): void {
  const router = useRouter();
  const { user, ready } = useSession();

  useEffect(() => {
    if (ready && user && !seesSignupCalls(user)) router.replace(homeForRole(user.role));
  }, [ready, user, router]);
}
