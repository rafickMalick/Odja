"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { PrivacyNoteBanner } from "@/components/PrivacyNoteBanner";

import styles from "./page.module.css";

/* Les motifs de contact reprennent les rôles décrits dans le handoff :
   commande, produit, vente sur la marketplace. */
const SUBJECTS = [
  "Une commande en cours",
  "Un produit du catalogue",
  "Devenir fabricant sur Ojà",
  "Livraison et retours",
  "Autre demande",
];

const CHANNELS = [
  {
    icon: "/images/icon-account.svg",
    title: "Support Ojà",
    text: "Toutes les demandes passent par le Support : acheteurs comme créateurs.",
    value: "support@oja.market",
  },
  {
    icon: "/images/icon-package.svg",
    title: "Suivi de commande",
    text: "Munissez-vous de votre numéro de commande, il accélère le traitement.",
    value: "Réponse sous 24 h ouvrées",
  },
  {
    icon: "/images/icon-vehicle.svg",
    title: "Ateliers partenaires",
    text: "Cotonou, Bénin — les visites d'atelier se font sur rendez-vous.",
    value: "Du lundi au vendredi, 9 h – 18 h",
  },
];

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  /* Aucun backend : on affiche l'accusé de réception côté navigateur. */
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSent(true);
  };

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
          <form className={styles.form} onSubmit={handleSubmit}>
            <h2 className={styles.blockTitle}>Votre message</h2>

            {sent ? (
              <div className={styles.sent}>
                <span className={styles.sentIcon}>
                  <img src="/images/icon-check.svg" alt="" />
                </span>
                <div>
                  <p className={styles.sentTitle}>Message bien reçu</p>
                  <p className={styles.sentText}>
                    Notre équipe Support vous répond sous 24 heures ouvrées à
                    l&apos;adresse indiquée.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.fields}>
                  <FieldRow>
                    <Field label="Nom et prénoms *" name="name" required />
                    <Field
                      label="Adresse e-mail *"
                      name="email"
                      type="email"
                      placeholder="jean@email.com"
                      required
                    />
                  </FieldRow>

                  <FieldRow>
                    <Field label="Motif de la demande *">
                      <select
                        name="subject"
                        className={fieldStyles.control}
                        defaultValue={SUBJECTS[0]}
                      >
                        {SUBJECTS.map((subject) => (
                          <option key={subject}>{subject}</option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Numéro de commande"
                      name="order"
                      placeholder="#CMD-2026-00000"
                    />
                  </FieldRow>

                  <Field label="Message *">
                    <textarea
                      name="message"
                      required
                      className={`${fieldStyles.control} ${fieldStyles.textarea}`}
                      placeholder="Décrivez votre demande le plus précisément possible."
                    />
                  </Field>
                </div>

                <Button type="submit">Envoyer le message</Button>
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
