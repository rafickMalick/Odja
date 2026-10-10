"use client";

import type {
  ExhibitionPassView,
  PassFormat,
  PublicExhibition,
  TicketCheckout,
} from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";
import { isCheckoutClosedByUser, openKkiapayCheckout } from "@/lib/kkiapay";
import { useSession } from "@/lib/session";

import styles from "../expositions.module.css";

/**
 * Ce que le visiteur doit faire pour ouvrir la galerie (§ 8).
 *
 * Inscription, billet ou code : un geste, expliqué en une phrase, avec le
 * prix affiché avant tout paiement. Au retour d'un paiement, le billet est
 * vérifié auprès du serveur — jamais confirmé sur la seule foi du navigateur.
 */
export function AccessPanel({
  exhibition,
  onUnlocked,
}: {
  exhibition: PublicExhibition;
  onUnlocked: () => Promise<void>;
}) {
  const { user, ready } = useSession();
  const [format, setFormat] = useState<PassFormat>(
    exhibition.format === "PHYSICAL" ? "ONSITE" : "ONLINE",
  );
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<ExhibitionPassView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* Retour d'un paiement : l'agrégateur renvoie sur la page avec la référence
     du billet. On la vérifie, puis on recharge la galerie. */
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("billet");
    if (!reference || !user) return;
    void verify(reference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      if (!isCheckoutClosedByUser(cause)) {
        setMessage(
          cause instanceof ApiError
            ? cause.message
            : "L’opération a échoué. Réessayez.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = (reference: string, providerRef?: string) =>
    run(() => confirm(reference, providerRef));

  /* Le serveur relit la transaction auprès de KKiaPay : l'identifiant appris
     par le widget l'y aide, il ne prouve rien à lui seul. */
  const confirm = async (reference: string, providerRef?: string) => {
    const pass = await apiFetch<ExhibitionPassView>(
      `/exhibitions/passes/${reference}/verify`,
      {
        method: "POST",
        body: providerRef ? { providerRef } : {},
      },
    );
    if (pass.status === "CONFIRMED") {
      await onUnlocked();
    } else {
      setPending(pass);
      setMessage(
        "Paiement pas encore confirmé. Vérifiez à nouveau dans un instant.",
      );
    }
  };

  const register = () =>
    run(async () => {
      await apiFetch(`/exhibitions/${exhibition.slug}/register`, {
        method: "POST",
        body: { format },
      });
      await onUnlocked();
    });

  const redeem = () =>
    run(async () => {
      await apiFetch(`/exhibitions/${exhibition.slug}/code`, {
        method: "POST",
        body: { code, format },
      });
      await onUnlocked();
    });

  const buy = () =>
    run(async () => {
      const ticket = await apiFetch<TicketCheckout>(
        `/exhibitions/${exhibition.slug}/tickets`,
        {
          method: "POST",
          body: { format },
        },
      );
      setPending(ticket.pass);

      if (ticket.checkout.mode === "redirect" && ticket.checkout.redirectUrl) {
        window.location.assign(ticket.checkout.redirectUrl);
        return;
      }
      if (ticket.checkout.mode === "widget" && ticket.checkout.publicKey) {
        /* KKiaPay : notre identifiant de billet voyage en `partnerId`, ce qui
           empêche de confirmer ce billet avec une autre transaction. */
        const transactionId = await openKkiapayCheckout({
          publicKey: ticket.checkout.publicKey,
          amountXof: ticket.checkout.amountXof,
          reference: ticket.checkout.reference,
          sandbox: ticket.checkout.sandbox ?? false,
          customer: ticket.customer,
          method: "momo",
        });
        await confirm(ticket.pass.reference, transactionId);
      }
      /* Mode simulé : rien à afficher, le bouton de simulation prend le relais. */
    });

  const simulate = () =>
    run(async () => {
      if (!pending) return;
      await apiFetch(
        `/exhibitions/passes/${pending.reference}/simulate-payment`,
        { method: "POST" },
      );
      await onUnlocked();
    });

  const formats: { value: PassFormat; label: string }[] =
    exhibition.format === "HYBRID"
      ? [
          { value: "ONLINE", label: "Visite en ligne" },
          { value: "ONSITE", label: "Visite sur place" },
        ]
      : [];

  const intro = {
    REGISTER:
      "L’organisateur demande une inscription gratuite avant la visite.",
    TICKET: `L’accès à la galerie est payant : ${formatFcfa(exhibition.ticketPriceXof)} le billet.`,
    CODE: "Cette exposition est réservée aux personnes invitées par l’organisateur.",
    OPEN: "",
  }[exhibition.requirement];

  return (
    <div className={styles.lock}>
      <p className={styles.lockText}>{intro}</p>

      {!ready ? null : !user ? (
        <Link
          href={`/connexion?suite=${encodeURIComponent(`/expositions/${exhibition.slug}`)}`}
          className={styles.heroLink}
        >
          Se connecter pour continuer
        </Link>
      ) : (
        <>
          {formats.length > 0 ? (
            <div
              className={styles.lockForm}
              role="radiogroup"
              aria-label="Format de la visite"
            >
              {formats.map((item) => (
                <label key={item.value} className={styles.notice}>
                  <input
                    type="radio"
                    name="format"
                    checked={format === item.value}
                    onChange={() => setFormat(item.value)}
                  />{" "}
                  {item.label}
                </label>
              ))}
            </div>
          ) : null}

          {exhibition.requirement === "REGISTER" ? (
            <Button
              type="button"
              onClick={() => void register()}
              disabled={busy}
            >
              {busy ? "Inscription…" : "M’inscrire gratuitement"}
            </Button>
          ) : null}

          {exhibition.requirement === "CODE" ? (
            <form
              className={styles.lockForm}
              onSubmit={(event) => {
                event.preventDefault();
                void redeem();
              }}
            >
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Code d’accès"
                aria-label="Code d’accès"
              />
              <Button type="submit" disabled={busy || code.trim().length < 4}>
                Valider
              </Button>
            </form>
          ) : null}

          {exhibition.requirement === "TICKET" ? (
            pending ? (
              <div className={styles.lockForm}>
                <Button
                  type="button"
                  onClick={() => void verify(pending.reference)}
                  disabled={busy}
                >
                  J’ai payé, vérifier mon billet
                </Button>
                {process.env.NODE_ENV !== "production" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void simulate()}
                    disabled={busy}
                  >
                    Simuler le paiement (test)
                  </Button>
                ) : null}
              </div>
            ) : (
              <Button type="button" onClick={() => void buy()} disabled={busy}>
                {busy
                  ? "Préparation…"
                  : `Acheter un billet — ${formatFcfa(exhibition.ticketPriceXof)}`}
              </Button>
            )
          ) : null}
        </>
      )}

      {message ? <p className={styles.error}>{message}</p> : null}
    </div>
  );
}
