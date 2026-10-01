"use client";

import type { CartView } from "@oja/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ApiError, apiFetch } from "./api";

/**
 * Panier serveur.
 *
 * Il ne vit plus dans `localStorage` : c'est l'API qui le tient, y compris
 * pour un visiteur non connecté  un jeton de cookie suffit. Deux
 * conséquences qui comptent : le panier survit à un changement d'appareil, et
 * les prix affichés sont ceux que la commande retiendra.
 *
 * Le contexte ne recalcule rien. Les totaux et le regroupement par atelier
 * viennent du serveur : deux calculs parallèles finiraient par diverger, et
 * c'est toujours le client qui verrait le mauvais.
 */

const EMPTY: CartView = {
  id: "",
  groups: [],
  itemCount: 0,
  itemsFinalTotalXof: 0,
  hasIssues: false,
};

interface CartContextValue {
  cart: CartView;
  itemCount: number;
  /** false pendant le premier rendu, avant la réponse du serveur. */
  ready: boolean;
  /** Renseigné quand la dernière action a échoué. */
  error: string | null;
  add: (productId: string, quantity?: number) => Promise<void>;
  setQuantity: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartView>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<CartView | void>) => {
      setError(null);
      try {
        const result = await action();
        if (result) setCart(result);
      } catch (cause) {
        /* Le panier est un lieu de passage : une erreur ici ne doit pas
           bloquer la navigation. On l'affiche et on garde l'état précédent. */
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Le panier est momentanément indisponible.",
        );
      } finally {
        setReady(true);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    await run(() => apiFetch<CartView>("/cart"));
  }, [run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      itemCount: cart.itemCount,
      ready,
      error,
      add: (productId, quantity = 1) =>
        run(() =>
          apiFetch<CartView>("/cart/items", {
            method: "POST",
            body: { productId, quantity },
          }),
        ),
      setQuantity: (itemId, quantity) =>
        run(() =>
          apiFetch<CartView>(`/cart/items/${itemId}`, {
            method: "PATCH",
            body: { quantity },
          }),
        ),
      remove: (itemId) =>
        run(() => apiFetch<CartView>(`/cart/items/${itemId}`, { method: "DELETE" })),
      clear: async () => {
        await run(async () => {
          await apiFetch<void>("/cart", { method: "DELETE" });
          return EMPTY;
        });
      },
      refresh,
    }),
    [cart, ready, error, run, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart doit être utilisé dans un CartProvider");
  }
  return context;
}

/** Toutes les lignes, tous ateliers confondus. */
export function allLines(cart: CartView) {
  return cart.groups.flatMap((group) =>
    group.lines.map((line) => ({ ...line, shopName: group.shopName })),
  );
}
