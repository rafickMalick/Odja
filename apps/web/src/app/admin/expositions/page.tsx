"use client";

import type { AdminExhibitionSummary } from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { EmptyState, PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { STATUS_LABELS, STATUS_TONE, dateRange } from "@/lib/exhibitions";

import admin from "../admin.module.css";

/**
 * Demandes et expositions (§ 11.3). La file « À examiner » est celle qui
 * attend un geste ; les autres servent au suivi.
 */

const FILTERS = [
  { value: "SUBMITTED", label: "À examiner" },
  { value: "ACCEPTED", label: "Contrat et paiement" },
  { value: "SCHEDULED", label: "Programmées" },
  { value: "PUBLISHED", label: "En ligne" },
  { value: "SUSPENDED", label: "Suspendues" },
  { value: "", label: "Toutes" },
];

export default function AdminExhibitionsPage() {
  const [filter, setFilter] = useState("SUBMITTED");
  const [items, setItems] = useState<AdminExhibitionSummary[] | null>(null);

  useEffect(() => {
    setItems(null);
    void apiFetch<AdminExhibitionSummary[]>(`/admin/exhibitions${filter ? `?status=${filter}` : ""}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [filter]);

  return (
    <>
      <PageHead
        title="Expositions"
        subtitle="Demandes à examiner, contrats, paiements, programmation et mise en avant."
      />

      <div className={admin.filters}>
        {FILTERS.map((item) => (
          <button
            key={item.value || "all"}
            type="button"
            className={filter === item.value ? admin.filterActive : admin.filter}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState title="Rien ici" text="Aucune exposition ne correspond à ce filtre." />
        </Panel>
      ) : (
        <Panel>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exposition</th>
                  <th>Dates</th>
                  <th>Formule</th>
                  <th>Œuvres</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/admin/expositions/${item.id}`}>{item.title}</Link>
                      <p className={styles.muted}>{item.organizerName}</p>
                    </td>
                    <td>{dateRange(item.startsAt, item.endsAt)}</td>
                    <td>{item.planName ?? "—"}</td>
                    <td>
                      {item.workCount}
                      {item.pendingWorkCount > 0 ? (
                        <span className={styles.muted}> ({item.pendingWorkCount} à examiner)</span>
                      ) : null}
                    </td>
                    <td>
                      <Badge type={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                      {item.isFeatured ? <span className={styles.muted}> · à la une</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
