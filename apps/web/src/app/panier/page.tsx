"use client";

import { Fragment } from "react";

import { ButtonLink } from "@/components/Button";
import { PrivacyNoteBanner } from "@/components/PrivacyNoteBanner";
import { ProgressStepper } from "@/components/ProgressStepper";
import { StepperQuantity } from "@/components/StepperQuantity";
import { useCart } from "@/lib/cart";
import { formatFcfa } from "@/lib/format";

import styles from "./page.module.css";

/**
 * Panier.
 *
 * Les lignes sont **groupées par atelier** : chaque groupe donnera lieu à sa
 * propre livraison, et le client doit le savoir avant de payer, pas le
 * découvrir sur sa facture.
 *
 * Les totaux viennent du serveur. Les recalculer ici donnerait deux vérités
 * qui finiraient par diverger — et c'est toujours le client qui verrait la
 * mauvaise.
 */
export default function CartPage() {
  const { cart, itemCount, ready, error, setQuantity, remove } = useCart();

  if (!ready) {
    return (
      <main className={styles.page}>
        <div className={styles.section}>
          <p className={styles.emptyText}>Chargement du panier…</p>
        </div>
      </main>
    );
  }

  if (itemCount === 0) {
    return (
      <main className={styles.page}>
        <div className={styles.section}>
          <ProgressStepper current={0} />
          <h1 className={styles.title}>Votre panier</h1>
          <div className={styles.empty}>
            <p className={styles.emptyText}>
              Votre panier est vide. Parcourez le catalogue pour y ajouter une
              pièce.
            </p>
            <ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.section}>
        <ProgressStepper current={0} />
        <h1 className={styles.title}>
          Votre panier <span>({itemCount})</span>
        </h1>

        {error ? <p className={styles.noteText}>{error}</p> : null}

        <div className={styles.layout}>
          <div className={styles.listing}>
            {cart.groups.map((group) => (
              <Fragment key={group.makerId}>
                {/* Un en-tête par atelier : c'est l'unité de livraison. */}
                <div className={styles.selectionRow}>
                  <span className={styles.cardCategory}>
                    {group.shopName} · {group.city}
                  </span>
                  <span className={styles.summaryValue}>
                    {formatFcfa(group.itemsFinalSubtotalXof)}
                  </span>
                </div>

                {group.lines.map((line) => (
                  <article key={line.id} className={styles.card}>
                    {line.imageUrl ? (
                      <img src={line.imageUrl} alt="" className={styles.cardImage} />
                    ) : (
                      <div className={styles.cardImage} />
                    )}

                    <div className={styles.cardInfo}>
                      <div className={styles.cardMain}>
                        <div className={styles.cardHeading}>
                          <a href={`/produit/${line.slug}`} className={styles.cardName}>
                            {line.name}
                          </a>
                          <p className={styles.cardCategory}>
                            {line.isMadeToOrder
                              ? `Fabriquée sur commande · ${line.leadTimeDays ?? "?"} jours`
                              : `${line.available} disponible(s)`}
                          </p>
                        </div>

                        <div className={styles.cardPrices}>
                          <p className={styles.cardPrice}>
                            {formatFcfa(line.lineTotalXof)}
                          </p>
                        </div>
                      </div>

                      {/* Une ligne devenue incommandable le dit ici, pas au
                          moment de payer. */}
                      {line.issue ? (
                        <p className={styles.noteText}>{line.issue}</p>
                      ) : null}

                      <div className={styles.cardMeta}>
                        <StepperQuantity
                          value={line.quantity}
                          onChange={(quantity) => void setQuantity(line.id, quantity)}
                          label={line.name}
                        />
                        <button
                          type="button"
                          className={styles.cardRemove}
                          onClick={() => void remove(line.id)}
                        >
                          Retirer
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </Fragment>
            ))}
          </div>

          <aside className={styles.summary}>
            <h2 className={styles.summaryTitle}>Récapitulatif</h2>

            <div className={styles.summaryRows}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Articles</span>
                <span className={styles.summaryValue}>
                  {formatFcfa(cart.itemsFinalTotalXof)}
                </span>
              </div>

              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Livraison</span>
                <span className={styles.summaryValue}>
                  {/* Elle dépend de la distance et du véhicule : impossible à
                      annoncer avant de connaître l'adresse. */}
                  Calculée à l&apos;étape suivante
                </span>
              </div>
            </div>

            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Sous-total</span>
              <span className={styles.totalValue}>
                {formatFcfa(cart.itemsFinalTotalXof)}
              </span>
            </div>

            {cart.groups.length > 1 ? (
              <div className={styles.note}>
                <img src="/images/icon-info.svg" alt="" className={styles.noteIcon} />
                <p className={styles.noteText}>
                  Votre panier réunit {cart.groups.length} ateliers. Chacun
                  expédie séparément, avec ses propres frais de livraison.
                </p>
              </div>
            ) : null}

            <div className={styles.summaryActions}>
              <ButtonLink href="/checkout" fullWidth>
                Passer commande
              </ButtonLink>
              <ButtonLink href="/catalogue" variant="outline" fullWidth>
                Continuer mes achats
              </ButtonLink>
            </div>

            <PrivacyNoteBanner />
          </aside>
        </div>
      </div>
    </main>
  );
}
