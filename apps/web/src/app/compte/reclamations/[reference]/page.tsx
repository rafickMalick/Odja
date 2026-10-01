"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import { DISPUTE_TONE } from "../../status";
import thread from "./thread.module.css";

/**
 * Une réclamation, et son fil de discussion.
 *
 * Le fil oppose deux interlocuteurs seulement : vous et Ojà. Le créateur a le
 * sien, de son côté, avec la même équipe au milieu. Les deux ne se croisent
 * jamais  c'est ce qui distingue une place de marché d'un forum.
 */

interface Message {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: string;
}

interface Dispute {
  reference: string;
  orderReference: string;
  subOrderReference: string | null;
  status: keyof typeof DISPUTE_TONE;
  statusLabel: string;
  reasonLabel: string;
  resolution: string | null;
  refundXof: number | null;
  slaDueAt: string;
  messages: Message[];
  createdAt: string;
  resolvedAt: string | null;
}

export default function DisputeThreadPage() {
  const params = useParams<{ reference: string }>();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDispute(await apiFetch<Dispute>(`/disputes/${params.reference}`));
    } catch {
      setError("Cette réclamation est introuvable.");
    }
  }, [params.reference]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!dispute) return <p className={styles.muted}>Chargement…</p>;

  const closed = dispute.status === "RESOLVED" || dispute.status === "REJECTED";

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/disputes/${dispute.reference}/messages`, {
        method: "POST",
        body: { body },
      });
      setBody("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={dispute.reference}
        subtitle={`Commande ${dispute.orderReference} · ${dispute.reasonLabel}`}
        action={
          <Badge type={DISPUTE_TONE[dispute.status] ?? "pending"}>{dispute.statusLabel}</Badge>
        }
      />

      {closed ? (
        <Panel title="Décision">
          <p className={styles.muted}>{dispute.resolution ?? "Réclamation close."}</p>
          {dispute.refundXof !== null ? (
            <p>
              Remboursement : <strong>{formatFcfa(dispute.refundXof)}</strong>
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Échanges avec Ojà">
        <ul className={thread.messages}>
          {dispute.messages.map((message) => (
            <li
              key={message.id}
              className={message.fromAdmin ? thread.fromAdmin : thread.fromMe}
            >
              <span className={thread.author}>{message.fromAdmin ? "Ojà" : "Vous"}</span>
              <p>{message.body}</p>
              <time className={thread.time}>
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

        {error ? <p className={styles.error}>{error}</p> : null}

        {closed ? (
          <p className={styles.muted}>
            Cette réclamation est close. Contactez-nous si la décision vous paraît erronée.
          </p>
        ) : (
          <form onSubmit={send} className={thread.form}>
            <Field label="Votre message">
              <textarea
                className={fieldStyles.control}
                rows={3}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Ajoutez une précision, une photo décrite, un complément…"
              />
            </Field>
            <div className={styles.rowActions}>
              <Button type="submit" disabled={busy || body.trim().length === 0}>
                {busy ? "…" : "Envoyer"}
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
