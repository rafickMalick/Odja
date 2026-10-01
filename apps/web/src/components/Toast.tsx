"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import styles from "./Toast.module.css";

/**
 * Popups de notification.
 *
 * Deux usages, volontairement distincts :
 *
 *   · **`notify()`**  un popup ponctuel, pour l'issue d'une action : une
 *     commande envoyée, un champ invalide au moment de valider. Il apparaît,
 *     reste quelques secondes, disparaît ;
 *   · **le statut d'un champ** (`FieldStatus`, dans `Field.tsx`)  un état
 *     posé à côté du champ lui-même, tant qu'il reste faux. Un popup à chaque
 *     frappe serait injouable ; l'état à côté du champ ne l'est pas.
 *
 * Le popup ne remplace donc pas le message d'erreur sous un champ  il
 * annonce l'issue d'ensemble, au moment où l'utilisateur agit.
 */

export interface ToastOptions {
  tone?: "success" | "error" | "info";
  /** Durée d'affichage, en millisecondes. */
  duration?: number;
}

interface ToastItem extends Required<ToastOptions> {
  id: number;
  message: string;
}

interface ToastContextValue {
  notify: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastItem["tone"], string> = {
  success: "✓",
  error: "✕",
  info: "i",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        message,
        tone: options?.tone ?? "info",
        duration: options?.duration ?? 4000,
      };
      setItems((current) => [...current, item]);
      window.setTimeout(() => dismiss(id), item.duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}

      {/* `aria-live="polite"` : un lecteur d'écran annonce le message sans
          interrompre ce que l'utilisateur était en train de faire. */}
      <div className={styles.stack} aria-live="polite" role="status">
        {items.map((item) => (
          <div key={item.id} className={styles.toast} data-tone={item.tone}>
            <span className={styles.icon} aria-hidden="true">
              {ICONS[item.tone]}
            </span>
            <p className={styles.message}>{item.message}</p>
            <button
              type="button"
              className={styles.close}
              aria-label="Fermer"
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * `notify()` en dehors de tout composant.
 *
 * Le hook `useToast()` reste la voie normale, mais un utilitaire (`api.ts`,
 * un gestionnaire hors React) n'a pas de composant : lever une erreur plutôt
 * que d'échouer en silence si le fournisseur n'est pas monté.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast() doit être appelé sous <ToastProvider>.");
  }
  return context;
}
