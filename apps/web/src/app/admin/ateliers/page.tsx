"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Validation des ateliers.
 *
 * C'est la file qui débloque tout le reste : tant qu'un dossier n'est pas
 * traité, l'artisan ne peut mettre aucune pièce en vente. Les pièces
 * justificatives ne sont lisibles que d'ici, par des URL à durée courte
 * délivrées à la demande.
 */

interface AdminMaker {
  id: string;
  slug: string;
  shopName: string;
  city: string;
  managerName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  ifuNumber: string | null;
  rccmNumber: string | null;
  kycStatus: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  kycSubmittedAt: string | null;
  kycRejectReason: string | null;
  productCount: number;
}

interface Document {
  id: string;
  type: string;
  status: string;
  note: string | null;
  createdAt: string;
  url?: string;
}

const FILTERS = [
  { value: "PENDING", label: "À traiter" },
  { value: "APPROVED", label: "Validés" },
  { value: "REJECTED", label: "Refusés" },
  { value: "", label: "Tous" },
];

const STATE: Record<
  AdminMaker["kycStatus"],
  { type: "pending" | "success" | "info" | "warning" | "danger"; label: string }
> = {
  NOT_SUBMITTED: { type: "pending", label: "Non déposé" },
  PENDING: { type: "info", label: "À traiter" },
  APPROVED: { type: "success", label: "Validé" },
  REJECTED: { type: "danger", label: "Refusé" },
};

export default function AdminMakersPage() {
  const [filter, setFilter] = useState("PENDING");
  const [makers, setMakers] = useState<AdminMaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMakers(
        await apiFetch<AdminMaker[]>(
          `/admin/makers${filter ? `?status=${filter}` : ""}`,
        ),
      );
    } catch {
      setMakers([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, decision: "APPROVE" | "REJECT") => {
    let reason: string | undefined;
    if (decision === "REJECT") {
      /* Le motif part à l'artisan. Un refus muet le laisse redéposer le même
         dossier indéfiniment. */
      const answer = window.prompt("Motif du refus (transmis au créateur) :");
      if (!answer?.trim()) return;
      reason = answer.trim();
    }

    setError(null);
    try {
      await apiFetch(`/admin/makers/${id}/review`, {
        method: "POST",
        body: { decision, ...(reason ? { reason } : {}) },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Décision impossible.");
    }
  };

  return (
    <>
      <PageHead
        title="Dossiers créateurs"
        subtitle="Chaque dossier en attente est un atelier qui ne peut rien vendre."
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

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : makers.length === 0 ? (
        <Panel>
          <EmptyState
            title="Rien à traiter"
            text="Aucun dossier ne correspond à ce filtre."
          />
        </Panel>
      ) : (
        makers.map((maker) => (
          <MakerCard key={maker.id} maker={maker} onReview={review} />
        ))
      )}
    </>
  );
}

function MakerCard({
  maker,
  onReview,
}: {
  maker: AdminMaker;
  onReview: (id: string, decision: "APPROVE" | "REJECT") => Promise<void>;
}) {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [busy, setBusy] = useState(false);

  /* Les URL de lecture sont à durée courte : on ne les demande qu'au moment où
     l'agent ouvre le dossier, pas pour toute la liste. */
  const loadDocuments = async () => {
    setBusy(true);
    setDocuments(
      await apiFetch<Document[]>(`/admin/makers/${maker.id}/documents`).catch(() => []),
    );
    setBusy(false);
  };

  const state = STATE[maker.kycStatus];

  return (
    <Panel
      title={maker.shopName}
      action={<Badge type={state.type}>{state.label}</Badge>}
    >
      <dl className={admin.details}>
        <div>
          <dt>Responsable</dt>
          <dd>{maker.managerName ?? "Non renseigné"}</dd>
        </div>
        <div>
          <dt>Ville</dt>
          <dd>{maker.city}</dd>
        </div>
        <div>
          <dt>Téléphone</dt>
          <dd>{maker.contactPhone ?? "Non renseigné"}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>{maker.contactEmail ?? "Non renseigné"}</dd>
        </div>
        <div>
          <dt>Adresse</dt>
          <dd>{maker.postalAddress ?? "Non renseigné"}</dd>
        </div>
        <div>
          <dt>IFU / RCCM</dt>
          <dd>{[maker.ifuNumber, maker.rccmNumber].filter(Boolean).join(" · ") || "Non renseigné"}</dd>
        </div>
        <div>
          <dt>Déposé le</dt>
          <dd>
            {maker.kycSubmittedAt
              ? new Date(maker.kycSubmittedAt).toLocaleDateString("fr-FR")
              : "Pas encore déposé"}
          </dd>
        </div>
        <div>
          <dt>Pièces au catalogue</dt>
          <dd>{maker.productCount}</dd>
        </div>
      </dl>

      {maker.kycRejectReason ? (
        <p className={styles.muted}>Dernier refus : {maker.kycRejectReason}</p>
      ) : null}

      {documents === null ? (
        <Button type="button" variant="outline" onClick={() => void loadDocuments()} disabled={busy}>
          {busy ? "Ouverture…" : "Voir les pièces justificatives"}
        </Button>
      ) : documents.length === 0 ? (
        <p className={styles.muted}>Aucune pièce déposée.</p>
      ) : (
        <ul className={admin.documents}>
          {documents.map((document) => (
            <li key={document.id}>
              <span>{document.type}</span>
              {document.url ? (
                <a href={document.url} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
              ) : (
                <span className={styles.muted}>lien indisponible</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {maker.kycStatus !== "APPROVED" ? (
        <div className={styles.rowActions}>
          <Button type="button" variant="outline" onClick={() => void onReview(maker.id, "REJECT")}>
            Refuser
          </Button>
          <Button type="button" onClick={() => void onReview(maker.id, "APPROVE")}>
            Valider l’atelier
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
