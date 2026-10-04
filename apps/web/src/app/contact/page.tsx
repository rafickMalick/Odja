"use client";

import {
  CONTACT_TICKET_CATEGORIES,
  type ContactMessageInput,
  type ContactReceipt,
  type ContactTicketCategory,
} from "@oja/contracts";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { PrivacyNoteBanner } from "@/components/PrivacyNoteBanner";
import { ApiError, apiFetch } from "@/lib/api";

import styles from "./page.module.css";

/**
 * Contact général, ouvert à tous.
 *
 * Pour les questions d'avant-inscription ou sans lien avec un compte. Le
 * message devient une demande dans la file du service client ; la référence
 * s'affiche ici et part aussi par e-mail. Un client connecté est invité à
 * écrire depuis son espace, où il suit sa demande.
 */

const CHANNELS = [
  {
    icon: "/images/icon-account.svg",
    title: "Support Ojà",
    text: "Toutes les demandes passent par le Support : acheteurs comme créateurs.",
    value: "oja@aworix.agency",
  },
  {
    icon: "/images/icon-package.svg",
    title: "Une commande en cours ?",
    text: "Écrivez depuis votre compte : la commande est jointe, et vous suivez la réponse.",
    value: "Réponse sous 24 h ouvrées",
  },
  {
    icon: "/images/icon-vehicle.svg",
    title: "Ateliers partenaires",
    text: "Cotonou, Bénin. Les visites d'atelier se font sur rendez-vous.",
    value: "Du lundi au vendredi, 9 h – 18 h",
  },
];

export default function ContactPage() {
  const [reference, setReference] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);

  /* L'accusé de réception ne s'affiche qu'une fois le message réellement
     enregistré : un « message bien reçu » pour un message perdu laisse le
     visiteur attendre une réponse qui ne viendra jamais. */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: ContactMessageInput = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      category: String(form.get("category") ?? "") as ContactTicketCategory,
      message: String(form.get("message") ?? ""),
      website: String(form.get("website") ?? ""),
    };

    setPending(true);
    setError(null);
    try {
      const receipt = await apiFetch<ContactReceipt | { reference: null }>("/contact", {
        method: "POST",
        body,
      });
      setReference(receipt.reference);
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : "Envoi impossible pour le moment. Vérifiez votre connexion et réessayez.",
      );
    } finally {
      setPending(false);
    }
  };

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;
  const formError =
    error instanceof ApiError ? (error.problem.errors?.length ? null : error.message) : error;

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Contact</p>
          <h1 className={styles.title}>Une question ? Écrivez-nous.</h1>
          <p className={styles.lead}>
            Ojà gère les paiements et la coordination entre créateurs et clients.
            Pour préserver la confidentialité des deux parties, toutes les
            demandes transitent par notre équipe Support.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.layout}>
          <form className={styles.form} onSubmit={handleSubmit} noValidate={false}>
            <h2 className={styles.blockTitle}>Votre message</h2>

            {sent ? (
              <div className={styles.sent} role="status">
                <span className={styles.sentIcon}>
                  <img src="/images/icon-check.svg" alt="" />
                </span>
                <div>
                  <p className={styles.sentTitle}>Message bien reçu</p>
                  <p className={styles.sentText}>
                    {reference ? (
                      <>
                        Sa référence : <strong>{reference}</strong>. Un e-mail de
                        confirmation vient de partir ; notre équipe Support vous répond
                        sous 24 heures ouvrées à l&apos;adresse indiquée.
                      </>
                    ) : (
                      <>Notre équipe Support vous répond sous 24 heures ouvrées.</>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className={styles.sentText}>
                  Vous avez un compte ? Écrivez plutôt depuis{" "}
                  <Link href="/compte/support">votre espace</Link> : vous y suivez la
                  réponse, et vous pouvez joindre une commande.
                </p>

                <div className={styles.fields}>
                  <FieldRow>
                    <Field
                      label="Nom et prénoms *"
                      name="name"
                      autoComplete="name"
                      maxLength={80}
                      error={fieldError("name")}
                      required
                    />
                    <Field
                      label="Adresse e-mail *"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="jean@email.com"
                      error={fieldError("email")}
                      required
                    />
                  </FieldRow>

                  <Field label="Sujet *" error={fieldError("category")}>
                    <select
                      name="category"
                      className={fieldStyles.control}
                      defaultValue="question_generale"
                    >
                      {Object.entries(CONTACT_TICKET_CATEGORIES).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Message *" error={fieldError("message")}>
                    <textarea
                      name="message"
                      required
                      minLength={10}
                      maxLength={5000}
                      className={`${fieldStyles.control} ${fieldStyles.textarea}`}
                      placeholder="Décrivez votre demande le plus précisément possible."
                    />
                  </Field>

                  {/* Piège à robots : invisible et hors du parcours clavier.
                      Un humain ne le remplit jamais ; un robot si. */}
                  <div className={styles.trap} aria-hidden="true">
                    <label>
                      Site web
                      <input type="text" name="website" tabIndex={-1} autoComplete="off" />
                    </label>
                  </div>
                </div>

                {formError ? (
                  <p className={styles.formError} role="alert">
                    {formError}
                  </p>
                ) : null}

                <Button type="submit" disabled={pending}>
                  {pending ? "Envoi…" : "Envoyer le message"}
                </Button>
              </>
            )}

            <PrivacyNoteBanner />
          </form>

          <aside className={styles.aside}>
            {CHANNELS.map((channel) => (
              <div key={channel.title} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon}>
                    <img src={channel.icon} alt="" />
                  </span>
                  <p className={styles.cardTitle}>{channel.title}</p>
                </div>
                <p className={styles.cardText}>{channel.text}</p>
                <p className={styles.cardValue}>{channel.value}</p>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </main>
  );
}
