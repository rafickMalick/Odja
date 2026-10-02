"use client";

import type { TicketMessageView } from "@oja/contracts";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import { workspaceStyles as styles } from "@/components/dashboard/Workspace";

import support from "./support.module.css";

/**
 * Fil d'une demande au service client.
 *
 * Le même composant sert au client (`side="customer"`) et à l'équipe
 * (`side="staff"`). Seule l'équipe voit les notes internes, que l'API ne
 * renvoie d'ailleurs jamais au client, et seule l'équipe peut en écrire.
 */
export function TicketThread({
  messages,
  side,
  closed,
  onSend,
}: {
  messages: TicketMessageView[];
  side: "customer" | "staff";
  /** Demande fermée : plus de réponse côté client. */
  closed: boolean;
  onSend: (body: string, internal: boolean) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend(body.trim(), internal);
      setBody("");
      setInternal(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  const authorOf = (message: TicketMessageView) => {
    if (message.internal) return "Note interne · invisible du client";
    if (side === "staff") return message.fromStaff ? "Service client Ojà" : "Client";
    return message.fromStaff ? "Service client Ojà" : "Vous";
  };

  const classOf = (message: TicketMessageView) => {
    if (message.internal) return support.internal;
    const mine = side === "staff" ? message.fromStaff : !message.fromStaff;
    return mine ? support.mine : support.theirs;
  };

  return (
    <>
      <ul className={support.messages}>
        {messages.map((message) => (
          <li key={message.id} className={classOf(message)}>
            <span className={support.author}>{authorOf(message)}</span>
            <p>{message.body}</p>
            <time className={support.time} dateTime={message.createdAt}>
              {new Date(message.createdAt).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </li>
        ))}
      </ul>

      {closed && side === "customer" ? (
        <p className={styles.muted}>
          Cette demande est fermée. Si le problème persiste, ouvrez une nouvelle demande.
        </p>
      ) : (
        <form onSubmit={send} className={support.form}>
          <Field label={side === "staff" ? "Votre réponse" : "Votre message"}>
            <textarea
              className={`${fieldStyles.control} ${fieldStyles.textarea}`}
              rows={4}
              value={body}
              maxLength={5000}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                side === "staff"
                  ? "Répondez au client, ou cochez « note interne » pour l'équipe."
                  : "Ajoutez une précision ou répondez au service client."
              }
            />
          </Field>
          {side === "staff" ? (
            <label className={support.check}>
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />
              Note interne (jamais visible du client)
            </label>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.rowActions}>
            <Button type="submit" disabled={busy || body.trim().length === 0}>
              {busy ? "Envoi…" : internal ? "Ajouter la note" : "Envoyer"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
