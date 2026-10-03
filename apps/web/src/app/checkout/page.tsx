"use client";

import type { CheckoutQuote, PromoView, PublicAddress } from "@oja/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { PrivacyNoteBanner } from "@/components/PrivacyNoteBanner";
import { ProgressStepper } from "@/components/ProgressStepper";
import { ApiError, apiFetch, newIdempotencyKey } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { formatFcfa, formatNumber } from "@/lib/format";
import { isCheckoutClosedByUser, openKadevPayCheckout } from "@/lib/kadevpay";

import styles from "./page.module.css";

interface City {
  id: string;
  name: string;
}

/**
 * Passage en caisse.
 *
 * Le chiffrage vient du serveur : une livraison par atelier, distance réelle,
 * véhicule choisi automatiquement. Le navigateur n'invente aucun montant  il
 * affiche ce que la commande retiendra, puis **confirme** ce total au moment
 * de valider.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const { cart, itemCount, ready, refresh } = useCart();

  const [addresses, setAddresses] = useState<PublicAddress[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [addressId, setAddressId] = useState<string>("");
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [promoInput, setPromoInput] = useState("");
  /* Raison d'un refus, sous le champ. Gardée à part du chiffrage : sinon le
     second chiffrage, refait sans le code refusé, l'effaçait aussitôt et le
     client ne voyait rien se passer. */
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoPending, setPromoPending] = useState(false);
  // Code effectivement appliqué au chiffrage  repassé tel quel à la commande.
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  // Mobile Money par défaut : c'est le moyen dominant sur ce marché.
  const [paymentMethod, setPaymentMethod] = useState<"momo" | "card">("momo");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const addressFormRef = useRef<HTMLDivElement>(null);
  /* Une clé d'idempotence par intention de commande : la même tant que le
     contenu envoyé ne change pas. Un double clic, ou un nouvel essai après
     une réponse perdue, retrouve la commande déjà créée au lieu d'en créer
     une seconde ; changer d'adresse ou de total en fait une nouvelle. */
  const orderIntentRef = useRef<{ body: string; key: string } | null>(null);

  // ── Chargement des adresses du client ──
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [list, cityList, me] = await Promise.all([
          apiFetch<PublicAddress[]>("/me/addresses"),
          apiFetch<City[]>("/geo/cities"),
          apiFetch<{ email: string }>("/auth/me"),
        ]);
        if (cancelled) return;
        setAddresses(list);
        setCities(cityList);
        setCustomerEmail(me.email);
        setAddressId(list.find((address) => address.isDefault)?.id ?? list[0]?.id ?? "");
      } catch (cause) {
        if (cancelled) return;
        /* Le panier est ouvert aux visiteurs, la commande non : on le dit
           clairement plutôt que de laisser la page échouer. */
        if (cause instanceof ApiError && cause.isUnauthorized) setNeedsAuth(true);
        else setError("Impossible de charger vos adresses.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Chiffrage, refait à chaque changement d'adresse ou de code promo ──
  const requestQuote = useCallback(async (selected: string, code: string | null) => {
    if (!selected) return;
    setError(null);
    try {
      const result = await apiFetch<CheckoutQuote>("/checkout/quote", {
        method: "POST",
        body: { addressId: selected, ...(code ? { promoCode: code } : {}) },
      });
      setQuote(result);
      // Le code n'est « appliqué » que si le serveur l'a retenu. S'il tombe
      // entre-temps (épuisé, expiré), on dit pourquoi au lieu de l'effacer.
      if (code && !result.promo) {
        setPromoError(
          result.blockers.find((message) => message.includes(code)) ??
            `Le code « ${code} » ne s’applique plus.`,
        );
      }
      setAppliedPromo(result.promo?.code ?? null);
    } catch (cause) {
      setQuote(null);
      setError(cause instanceof ApiError ? cause.message : "Chiffrage indisponible.");
    }
  }, []);

  useEffect(() => {
    void requestQuote(addressId, appliedPromo);
  }, [addressId, appliedPromo, requestQuote]);

  /* Le code est d'abord vérifié seul : refusé, sa raison s'affiche sous le
     champ et le chiffrage n'est pas touché ; accepté, il entre dans le
     chiffrage (l'effet ci-dessus). */
  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    if (!addressId) {
      setPromoError("Choisissez d’abord une adresse de livraison : la remise en dépend.");
      return;
    }
    setPromoPending(true);
    setPromoError(null);
    try {
      await apiFetch<PromoView>("/checkout/promo", {
        method: "POST",
        body: { addressId, code },
      });
      setAppliedPromo(code);
    } catch (cause) {
      setPromoError(
        cause instanceof ApiError ? cause.message : "Vérification du code impossible. Réessayez.",
      );
    } finally {
      setPromoPending(false);
    }
  };

  const clearPromo = () => {
    setPromoInput("");
    setPromoError(null);
    setAppliedPromo(null);
  };

  const handleCreateAddress = async () => {
    const container = addressFormRef.current;
    if (!container) return;

    /* On relit les champs depuis le DOM plutôt que de tenir sept états : le
       formulaire est saisi une fois, et l'adresse enregistrée devient une
       option comme les autres. */
    const read = (name: string) =>
      container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)
        ?.value ?? '';

    setError(null);

    try {
      const created = await apiFetch<PublicAddress>("/me/addresses", {
        method: "POST",
        body: {
          fullName: read("fullName"),
          phone: read("phone"),
          cityId: read("cityId"),
          line1: read("line1"),
          landmark: read("landmark") || undefined,
        },
      });
      setAddresses((current) => [created, ...current]);
      setAddressId(created.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Adresse refusée.");
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quote || quote.blockers.length > 0) return;

    /* On renvoie le total affiché : le serveur refuse s'il a changé
       entre-temps. Le client confirme un montant, il ne le fixe pas. */
    const orderBody = {
      addressId,
      expectedTotalXof: quote.totalXof,
      ...(quote.promo ? { promoCode: quote.promo.code } : {}),
    };
    const signature = JSON.stringify(orderBody);
    if (orderIntentRef.current?.body !== signature) {
      orderIntentRef.current = { body: signature, key: newIdempotencyKey() };
    }
    const orderKey = orderIntentRef.current.key;

    setSubmitting(true);
    setError(null);
    try {
      const order = await apiFetch<{
        reference: string;
        shipFullName: string;
        shipPhone: string;
        checkout?: {
          mode: "widget" | "redirect" | "simulated";
          publicKey?: string;
          amountXof: number;
          reference: string;
        };
      }>("/checkout", {
        method: "POST",
        body: orderBody,
        idempotencyKey: orderKey,
      });
      await refresh();

      if (order.checkout?.mode === "widget" && order.checkout.publicKey) {
        try {
          const providerRef = await openKadevPayCheckout({
            publicKey: order.checkout.publicKey,
            amountXof: order.checkout.amountXof,
            reference: order.checkout.reference,
            customer: {
              fullName: order.shipFullName,
              email: customerEmail,
              phone: order.shipPhone,
            },
            method: paymentMethod,
          });

          /* Confirme tout de suite, avec la référence que le widget vient
             d'apprendre  sans attendre un webhook qui exige une URL
             publique. Voir openKadevPayCheckout() et
             PaymentService.verifyPending(). */
          await apiFetch(`/orders/${order.reference}/verify-payment`, {
            method: "POST",
            body: { providerRef },
          });
        } catch (widgetError) {
          if (!isCheckoutClosedByUser(widgetError)) {
            /* Le script n'a pas pu se charger ou s'est comporté de façon
               inattendue  non testé contre un vrai compte à ce jour. La
               commande existe déjà côté serveur, en attente de paiement : on
               envoie quand même vers la confirmation, qui dira la vérité
               plutôt que de bloquer le client sur cette page. */
            // eslint-disable-next-line no-console
            console.error("Kadev Pay :", widgetError);
          }
        }
      }

      router.push(`/confirmation?commande=${order.reference}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "La commande n'a pas pu être enregistrée.",
      );
      void requestQuote(addressId, appliedPromo);
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <main className={styles.page}>
        <div className={styles.section}>
          <p className={styles.subtitle}>Chargement…</p>
        </div>
      </main>
    );
  }

  if (needsAuth) {
    return (
      <main className={styles.page}>
        <ProgressStepper current={1} />
        <div className={styles.section}>
          <h1 className={styles.title}>Connectez-vous pour commander</h1>
          <p className={styles.subtitle}>
            Votre panier est conservé. Il vous suffit de vous identifier pour
            renseigner une adresse de livraison.
          </p>
          <Button onClick={() => router.push("/connexion?suite=/checkout")}>
            Se connecter
          </Button>
        </div>
      </main>
    );
  }

  if (itemCount === 0) {
    return (
      <main className={styles.page}>
        <ProgressStepper current={1} />
        <div className={styles.section}>
          <h1 className={styles.title}>Votre panier est vide</h1>
          <Button onClick={() => router.push("/catalogue")}>
            Découvrir le catalogue
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <ProgressStepper current={1} />

      <form className={styles.section} onSubmit={handleSubmit}>
        <div className={styles.layout}>
          <div className={styles.form}>
            <div className={styles.intro}>
              <h1 className={styles.title}>Livraison et paiement</h1>
              <p className={styles.subtitle}>
                Chaque atelier expédie séparément. Les frais sont calculés à la
                distance réelle entre son atelier et votre adresse.
              </p>
            </div>

            <div className={styles.block}>
              <h2 className={styles.blockTitle}>Adresse de livraison</h2>

              {addresses.length > 0 ? (
                <div className={styles.options}>
                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className={`${styles.option} ${
                        addressId === address.id ? styles.optionSelected : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        value={address.id}
                        checked={addressId === address.id}
                        onChange={() => setAddressId(address.id)}
                        className={styles.checkbox}
                      />
                      <span className={styles.optionBody}>
                        <span className={styles.optionTitle}>
                          {address.fullName} · {address.city}
                        </span>
                        <span className={styles.optionText}>
                          {address.line1}
                          {address.landmark ? ` · ${address.landmark}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.block}>
              <h2 className={styles.blockTitle}>
                {addresses.length > 0 ? "Ajouter une adresse" : "Où livrer ?"}
              </h2>

              {/* Pas de <form> imbriqué  c'est du HTML invalide, et le
                  navigateur en fait ce qu'il veut. La saisie vit dans un
                  simple bloc, et son bouton appelle directement le
                  gestionnaire.

                  Aucun attribut `required` ici : ces champs appartiennent au
                  formulaire de commande, et le navigateur bloquerait
                  « Confirmer la commande » tant qu'ils sont vides, même avec
                  une adresse enregistrée sélectionnée. L'API valide
                  l'adresse à l'enregistrement et renvoie l'erreur affichée. */}
              <div className={styles.fields} ref={addressFormRef}>
                <>
                  <FieldRow>
                    <Field label="Nom et prénoms *" name="fullName" />
                    <Field
                      label="Téléphone *"
                      name="phone"
                      placeholder="+229 01 00 00 00 00"
                    />
                  </FieldRow>

                  <FieldRow>
                    <Field label="Ville *">
                      <select name="cityId" className={fieldStyles.control}>
                        {cities.map((city) => (
                          <option key={city.id} value={city.id}>
                            {city.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Repère"
                      name="landmark"
                      placeholder="En face de la pharmacie"
                    />
                  </FieldRow>

                  <Field label="Adresse *" name="line1" />

                  <Button type="button" variant="outline" onClick={handleCreateAddress}>
                    Enregistrer cette adresse
                  </Button>
                </>
              </div>
            </div>

            <div className={styles.block}>
              <h2 className={styles.blockTitle}>Moyen de paiement</h2>
              <p className={styles.subtitle}>
                Le choix décide des frais affichés par l’agrégateur : 2,3 % en Mobile
                Money, 4,5 % par carte.
              </p>

              <div className={styles.options}>
                <label
                  className={`${styles.option} ${
                    paymentMethod === "momo" ? styles.optionSelected : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="momo"
                    checked={paymentMethod === "momo"}
                    onChange={() => setPaymentMethod("momo")}
                    className={styles.checkbox}
                  />
                  <span className={styles.optionBody}>
                    <span className={styles.optionTitle}>Mobile Money</span>
                    <span className={styles.optionText}>MTN MoMo, Moov Money</span>
                  </span>
                </label>

                <label
                  className={`${styles.option} ${
                    paymentMethod === "card" ? styles.optionSelected : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="card"
                    checked={paymentMethod === "card"}
                    onChange={() => setPaymentMethod("card")}
                    className={styles.checkbox}
                  />
                  <span className={styles.optionBody}>
                    <span className={styles.optionTitle}>Carte bancaire</span>
                    <span className={styles.optionText}>Visa, Mastercard</span>
                  </span>
                </label>
              </div>
            </div>

            <PrivacyNoteBanner />
          </div>

          <aside className={styles.summary}>
            <h2 className={styles.summaryTitle}>Votre commande</h2>
            <p className={styles.summaryCount}>
              {itemCount} article{itemCount > 1 ? "s" : ""} ·{" "}
              {cart.groups.length} atelier{cart.groups.length > 1 ? "s" : ""}
            </p>

            <div className={styles.lines}>
              {cart.groups.flatMap((group) =>
                group.lines.map((line) => (
                  <div key={line.id} className={styles.line}>
                    {line.imageUrl ? (
                      <img src={line.imageUrl} alt="" className={styles.lineThumb} />
                    ) : (
                      <div className={styles.lineThumb} />
                    )}
                    <div className={styles.lineBody}>
                      <p className={styles.lineName}>{line.name}</p>
                      <p className={styles.lineMeta}>
                        {group.shopName} · × {line.quantity}
                      </p>
                    </div>
                    <p className={styles.linePrice}>{formatFcfa(line.lineTotalXof)}</p>
                  </div>
                )),
              )}
            </div>

            <div className={styles.totals}>
              <div className={styles.totalsRow}>
                <span className={styles.totalsLabel}>Articles</span>
                <span className={styles.totalsValue}>
                  {formatFcfa(quote?.itemsFinalTotalXof ?? cart.itemsFinalTotalXof)}
                </span>
              </div>

              {/* Une ligne par atelier : le client voit d'où vient chaque frais. */}
              {quote?.deliveries.map((delivery) => (
                <div key={delivery.makerId} className={styles.totalsRow}>
                  <span className={styles.totalsLabel}>
                    Livraison · {delivery.shopName}
                    <br />
                    <small>
                      {delivery.vehicle.toLowerCase()} · {formatNumber(delivery.distanceKm, 1)} km ·{" "}
                      {delivery.etaMinDays}–{delivery.etaMaxDays} jours
                    </small>
                  </span>
                  <span className={styles.totalsValue}>{formatFcfa(delivery.feeXof)}</span>
                </div>
              ))}

              {quote && quote.vatXof > 0 ? (
                <div className={styles.totalsRow}>
                  <span className={styles.totalsLabel}>TVA</span>
                  <span className={styles.totalsValue}>{formatFcfa(quote.vatXof)}</span>
                </div>
              ) : null}

              {quote && quote.discountXof > 0 ? (
                <div className={styles.totalsRow}>
                  <span className={styles.totalsLabel}>
                    Remise{quote.promo ? ` · ${quote.promo.code}` : ""}
                  </span>
                  <span className={styles.totalsValue}>− {formatFcfa(quote.discountXof)}</span>
                </div>
              ) : null}
            </div>

            {/* Code promo (cahier L2-11). */}
            <div className={styles.promoRow}>
              {quote?.promo ? (
                <p className={styles.promoApplied} role="status">
                  Code <strong>{quote.promo.code}</strong> appliqué : −{" "}
                  {formatFcfa(quote.discountXof)}
                  {quote.promo.capped ? (
                    <>
                      {" "}
                      (annoncé {quote.promo.label}, ramené au plafond de la remise Ojà sur
                      cette commande)
                    </>
                  ) : null}
                  .{" "}
                  <button type="button" className={styles.promoClear} onClick={clearPromo}>
                    Retirer
                  </button>
                </p>
              ) : (
                <div className={styles.promoField}>
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    placeholder="Code promo"
                    value={promoInput}
                    onChange={(event) => {
                      setPromoInput(event.target.value);
                      setPromoError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void applyPromo();
                      }
                    }}
                    aria-label="Code promo"
                    aria-invalid={promoError ? true : undefined}
                    aria-describedby={promoError ? "promo-error" : undefined}
                    className={styles.promoInput}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void applyPromo()}
                    disabled={promoPending || !promoInput.trim()}
                  >
                    {promoPending ? "Vérification…" : "Appliquer"}
                  </Button>
                </div>
              )}
              {promoError && !quote?.promo ? (
                <p id="promo-error" className={styles.secureNote} role="alert">
                  {promoError}
                </p>
              ) : null}
            </div>

            <div className={styles.grandTotal}>
              <span className={styles.grandTotalLabel}>Total</span>
              <span className={styles.grandTotalValue}>
                {quote ? formatFcfa(quote.totalXof) : "À calculer"}
              </span>
            </div>

            {quote && quote.blockers.length > 0 ? (
              <ul className={styles.secureNote}>
                {quote.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}

            {error ? <p className={styles.secureNote}>{error}</p> : null}

            <Button
              type="submit"
              fullWidth
              disabled={!quote || quote.blockers.length > 0 || submitting}
            >
              {submitting ? "Enregistrement…" : "Confirmer la commande"}
            </Button>
          </aside>
        </div>
      </form>
    </main>
  );
}
