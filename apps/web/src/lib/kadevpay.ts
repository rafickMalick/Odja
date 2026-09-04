/**
 * Widget Kadev Pay, chargé à la demande.
 *
 * Extrait de leur documentation publique (`pay.kadev.ci/developer-documentation`,
 * consultée le 15 août 2026) : aucune clé n'a encore été délivrée à ce jour,
 * ce fichier n'a donc pas pu être essayé contre un vrai paiement. Le point le
 * plus susceptible de bouger au premier essai réel est signalé plus bas.
 *
 * Le script n'est chargé **que si un paiement réel est amorcé** — c'est-à-dire
 * quand `checkout.mode === "widget"`, jamais en développement où le
 * fournisseur simulé ne renvoie que `"simulated"`. Un script tiers chargé sur
 * chaque visite ralentirait chaque page pour un besoin qui ne se présente
 * qu'au paiement.
 */

const SCRIPT_URL = "https://pay.kadev.ci/js/v1/kadev-pay.js";

interface KadevPayCheckoutParams {
  public_key: string;
  amount: number;
  email: string;
  name?: string;
  phone?: string;
  method?: "momo" | "card";
  callback_url?: string;
  metadata?: Record<string, string>;
  onSuccess?: (result: KadevPayCheckoutResult) => void;
  onClose?: () => void;
}

interface KadevPayCheckoutResult {
  /** La référence Kadev Pay de la transaction — ex. `KDV-1775413916000`. */
  reference: string;
  [key: string]: unknown;
}

interface KadevPayGlobal {
  checkout: (params: KadevPayCheckoutParams) => void;
}

declare global {
  interface Window {
    KadevPay?: KadevPayGlobal;
  }
}

let loading: Promise<KadevPayGlobal> | null = null;

/** Charge le script une seule fois, même si plusieurs paiements sont tentés. */
function loadKadevPay(): Promise<KadevPayGlobal> {
  if (window.KadevPay) return Promise.resolve(window.KadevPay);

  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        if (window.KadevPay) resolve(window.KadevPay);
        else reject(new Error("Le script Kadev Pay s’est chargé sans exposer window.KadevPay."));
      };
      script.onerror = () => reject(new Error("Le script Kadev Pay n’a pas pu être chargé."));
      document.head.appendChild(script);
    });
  }

  return loading;
}

export interface KadevPayCheckoutInput {
  publicKey: string;
  amountXof: number;
  reference: string;
  customer: { fullName: string; email: string; phone: string };
  /**
   * Obligatoire pour que Kadev Pay calcule les frais exacts affichés au
   * client dans le widget — leur documentation le signale en gras : sans ce
   * champ, rien ne garantit que la commission annoncée (2,3 % Mobile Money,
   * 4,5 % carte) corresponde à celle réellement prélevée.
   */
  method: "momo" | "card";
}

/**
 * Ouvre le widget d'encaissement et résout avec la référence Kadev Pay de la
 * transaction.
 *
 * **Aucune `callback_url` n'est passée, volontairement** : leur documentation
 * indique qu'`onSuccess` ne s'exécute que dans ce cas. C'est le chemin retenu
 * ici pour pouvoir confirmer un paiement réel sans dépendre d'un webhook
 * joignable — donc sans exiger d'URL publique tant que la plateforme n'est
 * pas encore déployée. Le webhook, une fois branché, restera la voie
 * recommandée par Kadev Pay pour la production ; ce chemin par le SDK n'a pas
 * vocation à la remplacer, seulement à permettre les essais avant qu'un
 * hébergement public n'existe.
 *
 * La référence renvoyée par `onSuccess` n'est qu'un confort d'affichage
 * client, pas une preuve de paiement à elle seule : c'est le serveur qui
 * tranche, en interrogeant Kadev Pay lui-même
 * (`POST /orders/:reference/verify-payment`, `provider.verify()`). Un
 * `onSuccess` qui mentirait — script modifié, extension de navigateur
 * malveillante — ne débloquerait donc rien tout seul.
 *
 * **Non vérifié en pratique** : le nom exact du champ qui porte notre
 * référence dans `metadata` (`order_id` a été choisi par analogie avec le
 * paramètre `metadata` documenté, mais leur doc ne montre aucun exemple
 * rempli), et le nom exact du champ de référence dans la réponse `onSuccess`
 * (`reference`, d'après leur seul exemple de code). À confirmer au premier
 * essai contre un compte test.
 */
export async function openKadevPayCheckout(input: KadevPayCheckoutInput): Promise<string> {
  const kadevPay = await loadKadevPay();

  return new Promise((resolve, reject) => {
    kadevPay.checkout({
      public_key: input.publicKey,
      amount: input.amountXof,
      email: input.customer.email,
      name: input.customer.fullName,
      phone: input.customer.phone,
      method: input.method,
      metadata: { order_id: input.reference },
      onSuccess: (result) => {
        if (typeof result.reference === "string" && result.reference.trim() !== "") {
          resolve(result.reference);
        } else {
          resolve(input.reference);
        }
      },
      onClose: () => reject(new Error("closed")),
    });
  });
}

/** Un abandon volontaire du widget n'est pas une erreur à afficher en rouge. */
export function isCheckoutClosedByUser(error: unknown): boolean {
  return error instanceof Error && error.message === "closed";
}
