"use client";

import type { ReportReason, ReportView } from "@oja/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState, PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Signalements de contenus (cahier des évolutions, § 13).
 *
 * Retenir un signalement peut masquer le contenu — fiche masquée, profil ou
 * exposition suspendus, œuvre retirée — sans rien supprimer. Chaque décision
 * est journalisée, et l'auteur du signalement est prévenu s'il a un compte.
 */

const REASON_LABELS: Record<ReportReason, string> = {
  UNAUTHORIZED_USE: "Publié sans autorisation",
  COUNTERFEIT: "Contrefaçon",
  MISLEADING: "Description trompeuse",
  INAPPROPRIATE: "Contenu inapproprié",
  OTHER: "Autre",
};

const FILTERS = [
  { value: "OPEN", label: "À traiter" },
  { value: "RESOLVED", label: "Retenus" },
  { value: "DISMISSED", label: "Écartés" },
  { value: "", label: "Tous" },
];

export default function ReportsPage() {
  const [filter, setFilter] = useState("OPEN");
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReports(await apiFetch<ReportView[]>(`/admin/reports${filter ? `?status=${filter}` : ""}`).catch(() => []));
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (report: ReportView, decision: "RESOLVED" | "DISMISSED", hideContent: boolean) => {
    const note = window.prompt(
      decision === "DISMISSED"
        ? "Pourquoi écarter ce signalement ?"
        : hideContent
          ? "Décision (le contenu sera masqué) :"
          : "Décision :",
    );
    if (!note?.trim()) return;
    setError(null);
    try {
      await apiFetch(`/admin/reports/${report.id}/resolve`, {
        method: "POST",
        body: { decision, note: note.trim(), hideContent },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Décision impossible.");
    }
  };

  return (
    <>
      <PageHead
        title="Signalements"
        subtitle="Photos, œuvres ou profils signalés par des visiteurs ou des ayants droit."
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

      {error ? <p className={styles.error}>{error}</p> : null}

      {reports === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : reports.length === 0 ? (
        <Panel>
          <EmptyState title="Rien à traiter" text="Aucun signalement ne correspond à ce filtre." />
        </Panel>
      ) : (
        reports.map((report) => (
          <Panel
            key={report.id}
            title={`${report.reference} · ${report.targetLabel}`}
            action={
              <Badge type={report.status === "OPEN" ? "warning" : report.status === "RESOLVED" ? "success" : "pending"}>
                {report.status === "OPEN" ? "À traiter" : report.status === "RESOLVED" ? "Retenu" : "Écarté"}
              </Badge>
            }
          >
            <dl className={admin.details}>
              <div>
                <dt>Motif</dt>
                <dd>{REASON_LABELS[report.reason]}</dd>
              </div>
              <div>
                <dt>Signalé par</dt>
                <dd>{report.reporter}</dd>
              </div>
              <div>
                <dt>Le</dt>
                <dd>{new Date(report.createdAt).toLocaleDateString("fr-FR")}</dd>
              </div>
              {report.targetHref ? (
                <div>
                  <dt>Contenu</dt>
                  <dd>
                    <Link href={report.targetHref} target="_blank">
                      Ouvrir
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.muted}>{report.details}</p>
            {report.resolution ? (
              <p className={styles.muted}>
                Décision : {report.resolution}
                {report.contentHidden ? " — contenu masqué" : ""}
              </p>
            ) : null}
            {report.status === "OPEN" ? (
              <div className={styles.rowActions}>
                <Button type="button" variant="outline" onClick={() => void resolve(report, "DISMISSED", false)}>
                  Écarter
                </Button>
                <Button type="button" variant="outline" onClick={() => void resolve(report, "RESOLVED", false)}>
                  Retenir sans masquer
                </Button>
                <Button type="button" onClick={() => void resolve(report, "RESOLVED", true)}>
                  Retenir et masquer le contenu
                </Button>
              </div>
            ) : null}
          </Panel>
        ))
      )}
    </>
  );
}
