"use client";

import {
  TICKET_STATUS_LABELS,
  type TicketStatus,
  type TicketSummaryView,
} from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { SUPPORT_TONE } from "@/app/compte/status";
import { Badge } from "@/components/Badge";
import { EmptyState, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";

import support from "./support.module.css";

const FILTERS: (TicketStatus | "ALL")[] = [
  "ALL",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

/**
 * « Mes demandes » : les tickets de la personne connectée, filtrables par
 * statut. L'API ne renvoie que les siens ; l'écran n'a rien à filtrer de plus.
 */
export function MyTickets({ basePath, refreshKey }: { basePath: string; refreshKey: number }) {
  const [status, setStatus] = useState<TicketStatus | "ALL">("ALL");
  const [tickets, setTickets] = useState<TicketSummaryView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTickets(null);
    void apiFetch<TicketSummaryView[]>(
      `/support/tickets${status === "ALL" ? "" : `?status=${status}`}`,
    )
      .then((list) => !cancelled && setTickets(list))
      .catch(() => !cancelled && setTickets([]));
    return () => {
      cancelled = true;
    };
  }, [status, refreshKey]);

  return (
    <>
      <div className={support.filters} role="tablist" aria-label="Filtrer par statut">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={status === value ? support.filterActive : support.filter}
            onClick={() => setStatus(value)}
          >
            {value === "ALL" ? "Toutes" : TICKET_STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {tickets === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : tickets.length === 0 ? (
        <EmptyState
          title={status === "ALL" ? "Aucune demande" : "Aucune demande avec ce statut"}
          text="Vos échanges avec le service client apparaîtront ici."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Demande</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Dernier message</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.reference}>
                  <td>
                    <Link href={`${basePath}/${ticket.reference}`}>
                      <strong>{ticket.subject}</strong>
                    </Link>
                    <div className={support.meta}>
                      <span>{ticket.reference}</span>
                      {ticket.orderReference ? <span>Commande {ticket.orderReference}</span> : null}
                    </div>
                  </td>
                  <td>{ticket.categoryLabel}</td>
                  <td>
                    <Badge type={SUPPORT_TONE[ticket.status] ?? "pending"}>
                      {ticket.statusLabel}
                    </Badge>
                  </td>
                  <td>{new Date(ticket.lastMessageAt).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
