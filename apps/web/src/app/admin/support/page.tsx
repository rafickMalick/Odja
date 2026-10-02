"use client";

import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type AdminTicketSummaryView,
} from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { SUPPORT_TONE } from "@/app/compte/status";
import { Badge } from "@/components/Badge";
import { Field, fieldStyles } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import support from "@/components/support/support.module.css";
import { apiFetch } from "@/lib/api";

/**
 * File du service client.
 *
 * Toutes les demandes, des espaces connectés comme du formulaire public, dans
 * une seule boîte. Les plus récemment actives en tête ; filtres et recherche
 * pour retrouver une demande citée au téléphone.
 */

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Acheteur",
  MAKER: "Créateur",
  COURIER: "Livreur",
  GUEST: "Visiteur / non inscrit",
};

const PRIORITY_TONE: Record<string, "pending" | "info" | "warning" | "danger"> = {
  LOW: "pending",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<AdminTicketSummaryView[] | null>(null);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    if (role) params.set("role", role);
    if (query) params.set("q", query);

    let cancelled = false;
    setTickets(null);
    void apiFetch<AdminTicketSummaryView[]>(`/admin/support/tickets?${params.toString()}`)
      .then((list) => !cancelled && setTickets(list))
      .catch(() => !cancelled && setTickets([]));
    return () => {
      cancelled = true;
    };
  }, [status, priority, category, role, query]);

  const select = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: Record<string, string>,
  ) => (
    <Field label={label}>
      <select
        className={fieldStyles.control}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Tous</option>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <>
      <PageHead
        title="Service client"
        subtitle="Toutes les demandes, des espaces connectés comme du formulaire de contact."
      />

      <Panel>
        <form
          className={support.fields}
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(q.trim());
          }}
        >
          <Field label="Rechercher : référence, sujet, nom ou e-mail">
            <input
              className={fieldStyles.control}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="SUP-2026-000123, Awa Koné…"
            />
          </Field>
          <div className={styles.statGrid}>
            {select("Statut", status, setStatus, TICKET_STATUS_LABELS)}
            {select("Priorité", priority, setPriority, TICKET_PRIORITY_LABELS)}
            {select("Type", category, setCategory, TICKET_CATEGORY_LABELS)}
            {select("Auteur", role, setRole, ROLE_LABELS)}
          </div>
        </form>
      </Panel>

      <Panel title={tickets ? `${tickets.length} demande${tickets.length > 1 ? "s" : ""}` : "Demandes"}>
        {tickets === null ? (
          <p className={styles.muted}>Chargement…</p>
        ) : tickets.length === 0 ? (
          <EmptyState title="Aucune demande" text="Rien ne correspond à ces filtres." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Demande</th>
                  <th>Auteur</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Priorité</th>
                  <th>Activité</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.reference}>
                    <td>
                      <Link href={`/admin/support/${ticket.reference}`}>
                        <strong>{ticket.subject}</strong>
                      </Link>
                      <div className={support.meta}>
                        <span>{ticket.reference}</span>
                        {ticket.orderReference ? <span>{ticket.orderReference}</span> : null}
                      </div>
                    </td>
                    <td>
                      {ticket.authorName}
                      <div className={support.meta}>
                        <span>
                          {ticket.isGuest
                            ? ticket.authorRole
                              ? `Formulaire public · ${ROLE_LABELS[ticket.authorRole] ?? ticket.authorRole}`
                              : "Visiteur / non inscrit"
                            : (ROLE_LABELS[ticket.authorRole ?? ""] ?? "")}
                        </span>
                      </div>
                    </td>
                    <td>{ticket.categoryLabel}</td>
                    <td>
                      <Badge type={SUPPORT_TONE[ticket.status] ?? "pending"}>
                        {TICKET_STATUS_LABELS[ticket.status]}
                      </Badge>
                    </td>
                    <td>
                      <Badge type={PRIORITY_TONE[ticket.priority] ?? "pending"}>
                        {TICKET_PRIORITY_LABELS[ticket.priority]}
                      </Badge>
                    </td>
                    <td>
                      {new Date(ticket.lastMessageAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
