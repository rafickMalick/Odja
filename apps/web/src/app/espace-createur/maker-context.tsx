"use client";

import type { AdminMaker } from "@oja/contracts";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { ApiError, apiFetch } from "@/lib/api";

/**
 * État du dossier créateur, partagé par toutes les pages de l'espace.
 *
 * Pourquoi un contexte plutôt qu'une simple requête sur chaque page : après
 * le dépôt du dossier, c'est ce même état qui décide si le reste de l'espace
 * s'ouvre. Sans un point commun, la page qui vient de déposer le sait, mais
 * la coquille qui décide de l'accès l'ignore encore — elle a fait sa requête
 * une fois, au montage, et ne la refait jamais.
 */

export type MakerState = "loading" | "ready" | "no-shop";

interface MakerContextValue {
  maker: AdminMaker | null;
  state: MakerState;
  /**
   * Vrai tant que la boutique ou le dossier ne sont pas déposés — refusé,
   * pas encore soumis, ou boutique manquante. C'est cette valeur, et elle
   * seule, qui décide si le reste de l'espace est joignable.
   */
  locked: boolean;
  /** À rappeler après toute action qui change le dossier : création de la
   *  boutique, dépôt du KYC. Sans cela, la coquille resterait sur l'état
   *  qu'elle avait au chargement de la page. */
  refresh: () => Promise<void>;
}

const MakerContext = createContext<MakerContextValue | null>(null);

export function MakerStatusProvider({
  children,
  onUnauthorized,
}: {
  children: ReactNode;
  onUnauthorized: () => void;
}) {
  const [maker, setMaker] = useState<AdminMaker | null>(null);
  const [state, setState] = useState<MakerState>("loading");

  const refresh = useCallback(async () => {
    try {
      const profile = await apiFetch<AdminMaker>("/maker/profile");
      setMaker(profile);
      setState("ready");
    } catch (cause) {
      if (cause instanceof ApiError && cause.isUnauthorized) {
        onUnauthorized();
        return;
      }
      // Compte créateur sans boutique : cas normal juste après l'inscription.
      setMaker(null);
      setState("no-shop");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const locked =
    state === "no-shop" ||
    (state === "ready" &&
      (maker?.kycStatus === "NOT_SUBMITTED" || maker?.kycStatus === "REJECTED"));

  return (
    <MakerContext.Provider value={{ maker, state, locked, refresh }}>
      {children}
    </MakerContext.Provider>
  );
}

export function useMakerStatus(): MakerContextValue {
  const context = useContext(MakerContext);
  if (!context) {
    throw new Error("useMakerStatus() doit être appelé sous <MakerStatusProvider>.");
  }
  return context;
}
