"use client";

import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type AdminTicketView,
  type TicketPriority,
  type TicketStatus,
} from "@oja/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SUPPORT_TONE } from "@/app/compte/status";
import { Badge } from "@/components/Badge";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { TicketThread } from "@/components/support/TicketThread";
import support from "@/components/support/support.module.css";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * Une demande, côté service client : le fil complet (notes internes
 * comprises), la réponse, le statut et la priorité.
 */

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Acheteur",
  MAKER: "Créateur",
  COURIER: "Livreur",
};

export default function AdminTicketPage() {
  const params = useParams<{ reference: string }>();
  const [ticket, setTicket] = useState<AdminTicketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setTicket(await apiFetch<AdminTicketView>(`/admin/support/tickets/${params.reference}`));
    } catch {
      setError("Cette demande est introuvable.");
    }
  }, [params.reference]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !ticket) return <p className={styles.error}>{error}</p>;
  if (!ticket) return <p className={styles.muted}>Chargement…</p>;

  const send = async (body: string, internal: boolean) => {
    try {
      setTicket(
        await apiFetch<AdminTicketView>(`/admin/support/tickets/${ticket.reference}/messages`, {
          method: "POST",
          body: { body, internal },
        }),
      );
    } catch (cause) {
      throw new Error(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    }
  };

  const update = async (change: { status?: TicketStatus; priority?: TicketPriority }) => {
    setSaving(true);
    setError(null);
    try {
      setTicket(
        await apiFetch<AdminTicketView>(`/admin/support/tickets/${ticket.reference}`, {
          method: "PATCH",
          body: change,
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Mise à jour refusée.");
    } finally {
      setSaving(false);
    }
  };

  const origin = ticket.isGuest
    ? ticket.userId
      ? "Formulaire de contact, relié à un compte existant"
      : "Formulaire de contact · visiteur non inscrit"
    : `Espace ${ROLE_LABELS[ticket.authorRole ?? ""]?.toLowerCase() ?? "connecté"}`;

  return (
    <>
      <PageHead
        title={ticket.subject}
        subtitle={`${ticket.reference} · ${ticket.categoryLabel}`}
        action={
          <Badge type={SUPPORT_TONE[ticket.status] ?? "pending"}>
            {TICKET_STATUS_LABELS[ticket.status]}
          </Badge>
        }
      />

      <p className={support.meta}>
        <span>
          <strong>{ticket.authorName}</strong> · {ticket.authorEmail}
        </span>
        <span>{origin}</span>
        {ticket.orderReference ? (
          <Link href={`/admin/commandes/recherche?q=${encodeURIComponent(ticket.orderReference)}`}>
            Commande {ticket.orderReference}
          </Link>
        ) : null}
        <span>Ouverte le {new Date(ticket.createdAt).toLocaleString("fr-FR")}</span>
        <Link href="/admin/support">Retour à la file</Link>
      </p>

      <Panel title="Suivi">
        <FieldRow>
          <Field label="Statut">
            <select
              className={fieldStyles.control}
              value={ticket.status}
              disabled={saving}
              onChange={(event) => void update({ status: event.target.value as TicketStatus })}
            >
              {Object.entries(TICKET_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {key === "WAITING_CUSTOMER" ? "En attente de réponse du client" : label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priorité">
            <select
              className={fieldStyles.control}
              value={ticket.priority}
              disabled={saving}
              onChange={(event) =>
                void update({ priority: event.target.value as TicketPriority })
              }
            >
              {Object.entries(TICKET_PRIORITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
        <p className={styles.muted}>
          Un changement de statut prévient le client, par e-mail et dans son espace.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </Panel>

      <Panel title="Échanges">
        <TicketThread
          messages={ticket.messages}
          side="staff"
          closed={false}
          onSend={send}
        />
      </Panel>
    </>
  );
}
