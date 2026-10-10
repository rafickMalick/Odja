"use client";

import type { ReportReason, ReportTarget } from "@oja/contracts";
import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

import { Button } from "./Button";
import { fieldStyles } from "./Field";
import styles from "./ReportButton.module.css";

/**
 * Signaler un contenu (cahier des évolutions, § 13).
 *
 * Discret — un lien sous le contenu — mais accessible à tous, connecté ou
 * non : un photographe dont l'image a été reprise n'a pas de compte Ojà. Un
 * visiteur anonyme laisse une adresse pour qu'on lui réponde.
 */

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "UNAUTHORIZED_USE", label: "Photo ou œuvre publiée sans autorisation" },
  { value: "COUNTERFEIT", label: "Contrefaçon ou copie" },
  { value: "MISLEADING", label: "Description trompeuse" },
  { value: "INAPPROPRIATE", label: "Contenu inapproprié" },
  { value: "OTHER", label: "Autre" },
];

export function ReportButton({
  targetType,
  targetId,
  label = "Signaler ce contenu",
}: {
  targetType: ReportTarget;
  targetId: string;
  label?: string;
}) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("UNAUTHORIZED_USE");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { reference } = await apiFetch<{ reference: string }>("/reports", {
        method: "POST",
        body: { targetType, targetId, reason, details, ...(user ? {} : { email }) },
      });
      setDone(reference);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className={styles.done} role="status">
        Merci. Votre signalement {done} est entre les mains de l’équipe Ojà.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={send}>
      <label className={styles.label}>
        Motif
        <select className={fieldStyles.control} value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
          {REASONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.label}>
        Ce qui pose problème
        <textarea
          className={fieldStyles.control}
          rows={3}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Par exemple : cette photo est la mienne, publiée sans mon accord."
        />
      </label>
      {!user ? (
        <label className={styles.label}>
          Votre e-mail, pour vous répondre
          <input
            className={fieldStyles.control}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy || details.trim().length < 10}>
          {busy ? "Envoi…" : "Envoyer le signalement"}
        </Button>
      </div>
    </form>
  );
}
