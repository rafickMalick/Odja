/**
 * Widget KKiaPay, chargé à la demande.
 *
 * Établi sur la documentation publique (`docs.kkiapay.me`) et sur le script
 * `https://cdn.kkiapay.me/k.js` lui-même, lu pour en connaître les écouteurs.
 * Pas encore essayé contre un compte réel.
 *
 * Le script n'est chargé **que si un paiement réel est amorcé** — quand
 * `checkout.mode === "widget"`, jamais avec le fournisseur simulé. Un script
 * tiers chargé sur chaque visite ralentirait chaque page pour un besoin qui
 * ne se présente qu'au paiement.
 */

const SCRIPT_URL = "https://cdn.kkiapay.me/k.js";

interface KkiapayWidgetOptions {
  amount: number;
  key: string;
  sandbox?: boolean;
  /** Notre identifiant de paiement : KKiaPay le conserve et le renvoie. */
  partnerId?: string;
  data?: string;
  name?: string;
  email?: string;
  phone?: string;
  paymentmethod?: "momo" | "card";
  countries?: string[];
}

interface KkiapaySuccessResponse {
  transactionId?: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    openKkiapayWidget?: (options: KkiapayWidgetOptions) => void;
    closeKkiapayWidget?: () => void;
    addSuccessListener?: (callback: (response: KkiapaySuccessResponse) => void) => void;
    addKkiapayCloseListener?: (callback: () => void) => void;
  }
}

let loading: Promise<void> | null = null;

/** Charge le script une seule fois, même si plusieurs paiements sont tentés. */
function loadKkiapay(): Promise<void> {
  if (window.openKkiapayWidget) return Promise.resolve();

  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.openKkiapayWidget) resolve();
        else reject(new Error("Le script KKiaPay s’est chargé sans exposer openKkiapayWidget."));
      };
      script.onerror = () => {
        // Un échec ne doit pas être retenu : le prochain essai recharge.
        loading = null;
        reject(new Error("Le script KKiaPay n’a pas pu être chargé."));
      };
      document.head.appendChild(script);
    });
  }

  return loading;
}

export interface KkiapayCheckoutInput {
  publicKey: string;
  amountXof: number;
  /** Notre identifiant de paiement, transmis comme `partnerId`. */
  reference: string;
  /** `true` : mode test, aucun argent réel ne bouge. */
  sandbox: boolean;
  customer: { fullName: string; email: string; phone: string };
  method: "momo" | "card";
}

/**
 * Ouvre le widget et résout avec l'identifiant de transaction KKiaPay.
 *
 * Cet identifiant n'est qu'un confort, pas une preuve de paiement : c'est le
 * serveur qui tranche, en relisant la transaction auprès de KKiaPay
 * (`POST /orders/:reference/verify-payment`). Un succès qui mentirait — script
 * modifié, extension malveillante — ne débloque donc rien tout seul, et une
 * transaction ouverte pour une autre commande est refusée (voir `partnerId`).
 *
 * Le widget ne se ferme pas de lui-même au succès : on le ferme ici.
 */
export async function openKkiapayCheckout(input: KkiapayCheckoutInput): Promise<string> {
  await loadKkiapay();

  return new Promise((resolve, reject) => {
    window.addSuccessListener?.((response) => {
      window.closeKkiapayWidget?.();
      if (typeof response.transactionId === "string" && response.transactionId.trim() !== "") {
        resolve(response.transactionId);
      } else {
        reject(new Error("KKiaPay n’a pas renvoyé d’identifiant de transaction."));
      }
    });
    // Fermeture avant paiement (le widget s'est déjà retiré lui-même).
    window.addKkiapayCloseListener?.(() => reject(new Error("closed")));

    window.openKkiapayWidget?.({
      key: input.publicKey,
      amount: input.amountXof,
      sandbox: input.sandbox,
      partnerId: input.reference,
      data: input.reference,
      name: input.customer.fullName,
      email: input.customer.email,
      // Format non documenté ; la doc donne « 22997000000 » en exemple (chiffres
      // seuls, indicatif compris). À confirmer au premier essai sandbox.
      phone: input.customer.phone.replace(/\D/g, ""),
      paymentmethod: input.method,
    });
  });
}

/** Un abandon volontaire du widget n'est pas une erreur à afficher en rouge. */
export function isCheckoutClosedByUser(error: unknown): boolean {
  return error instanceof Error && error.message === "closed";
}
