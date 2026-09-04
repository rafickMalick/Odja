import type { OrderView } from "@oja/contracts";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { ProgressStepper } from "@/components/ProgressStepper";
import { apiFetch, apiFetchOrNull } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import styles from "./page.module.css";

/**
 * Confirmation de commande.
 *
 * La page relit la commande depuis l'API, jamais depuis l'URL : c'est le
 * statut réel qui s'affiche, pas celui que la redirection prétend. Une
 * confirmation qui ment est pire qu'une confirmation absente.
 *
 * Avant de lire, elle **interroge activement l'agrégateur**
 * (`verify-payment`) : un widget redirige souvent le navigateur plus vite
 * qu'il n'envoie sa notification, et sans ce contrôle, un client qui vient de
 * payer verrait « en attente » pendant de longues secondes d'inquiétude
 * inutile. L'échec de cette vérification n'empêche pas la page de s'afficher
 * — elle retombe simplement sur la lecture simple, qui reflétera le statut
 * dès que le webhook sera arrivé.
 */
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ commande?: string }>;
}) {
  const { commande } = await searchParams;

  const order = commande
    ? ((await apiFetch<OrderView>(
        `/orders/${encodeURIComponent(commande)}/verify-payment`,
        { method: "POST" },
      ).catch(() => null)) ??
      (await apiFetchOrNull<OrderView>(`/orders/${encodeURIComponent(commande)}`)))
    : null;

  if (!order) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>
          <h1 className={styles.successTitle}>Commande introuvable</h1>
          <p className={styles.successText}>
            Cette commande n&apos;existe pas, ou elle appartient à un autre
            compte. Retrouvez vos commandes dans votre espace.
          </p>
          <ButtonLink href="/catalogue">Retour au catalogue</ButtonLink>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <ProgressStepper current={2} />

      <div className={styles.success}>
        <div className={styles.successHead}>
          <span className={styles.successIcon}>
            <img src="/images/icon-check.svg" alt="" />
          </span>
          <div>
            <h1 className={styles.successTitle}>Merci, votre commande est enregistrée</h1>
            <p className={styles.successSubtitle}>
              {/* Le statut vient de la base : il dira « En attente de paiement »
                  tant que l'encaissement n'est pas confirmé. */}
              {order.statusLabel}
            </p>
          </div>
        </div>

        <div className={styles.reference}>
          <span className={styles.referenceLabel}>Référence</span>
          <span className={styles.referenceValue}>{order.reference}</span>
          <span className={styles.referenceNote}>
            Conservez-la : elle accélère tout échange avec le Support.
          </span>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.left}>
          {/* Une section par atelier : chacun expédie séparément, et le client
              suivra deux livraisons distinctes. */}
          {order.subOrders.map((subOrder) => (
            <section key={subOrder.reference} className={styles.shipping}>
              <div className={styles.summaryHead}>
                <h2 className={styles.shippingTitle}>{subOrder.shopName}</h2>
                <span className={styles.shippingEta}>{subOrder.statusLabel}</span>
              </div>

              <div className={styles.lines}>
                {subOrder.lines.map((line) => (
                  <div key={line.productName} className={styles.line}>
                    <div className={styles.lineBody}>
                      <p className={styles.lineName}>{line.productName}</p>
                      <p className={styles.lineMeta}>× {line.quantity}</p>
                    </div>
                    <p className={styles.linePrice}>{formatFcfa(line.lineTotalXof)}</p>
                  </div>
                ))}
              </div>

              <div className={styles.shippingLine}>
                <span className={styles.shippingLabel}>Livraison</span>
                <span className={styles.shippingStrong}>
                  {formatFcfa(subOrder.deliveryFeeXof)}
                </span>
              </div>
            </section>
          ))}
        </div>

        <aside className={styles.summary}>
          <h2 className={styles.summaryTitle}>Récapitulatif</h2>

          <div className={styles.totals}>
            <div className={styles.totalsRow}>
              <span className={styles.totalsLabel}>Articles</span>
              <span className={styles.totalsValue}>
                {formatFcfa(order.itemsFinalTotalXof)}
              </span>
            </div>
            <div className={styles.totalsRow}>
              <span className={styles.totalsLabel}>Livraison</span>
              <span className={styles.totalsValue}>
                {formatFcfa(order.deliveryTotalXof)}
              </span>
            </div>
          </div>

          <div className={styles.grandTotal}>
            <span className={styles.grandTotalLabel}>Total</span>
            <span className={styles.grandTotalValue}>{formatFcfa(order.totalXof)}</span>
          </div>

          <div className={styles.rule} />

          <p className={styles.lineMeta}>
            Livrée à {order.shipFullName}, {order.shipLine1}
            {order.shipLandmark ? ` — ${order.shipLandmark}` : ""}
          </p>

          <div className={styles.actions}>
            <ButtonLink href="/catalogue" variant="outline" fullWidth>
              Continuer mes achats
            </ButtonLink>
            <Link href="/commandes" className={styles.lineMeta}>
              Suivre mes commandes
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
