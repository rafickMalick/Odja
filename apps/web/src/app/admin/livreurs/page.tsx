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
 * Validation des livreurs.
 *
 * Un livreur non validé n'apparaît dans aucune liste d'affectation : le filtre
 * est posé dans la requête, pas dans l'écran. Cette file est donc, au même
 * titre que celle des ateliers, un goulot d'étranglement du service  sans
 * livreur validé, aucune commande ne part.
 */

interface Courier {
  id: string;
  fullName: string;
  vehicle: string;
  plateNumber: string | null;
  payoutMsisdn: string | null;
  isAvailable: boolean;
  ratingAvg: number;
  kycStatus: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  kycSubmittedAt: string | null;
  kycRejectReason: string | null;
  deliveredCount: number;
}

interface Document {
  id: string;
  type: string;
  status: string;
  url?: string;
}

const FILTERS = [
  { value: "PENDING", label: "À traiter" },
  { value: "APPROVED", label: "Validés" },
  { value: "REJECTED", label: "Refusés" },
  { value: "", label: "Tous" },
];

const VEHICLES: Record<string, string> = {
  MOTO: "Moto",
  TRICYCLE: "Tricycle",
  CAMIONNETTE: "Camionnette",
};

const STATE: Record<
  Courier["kycStatus"],
  { type: "pending" | "success" | "info" | "danger"; label: string }
> = {
  NOT_SUBMITTED: { type: "pending", label: "Non déposé" },
  PENDING: { type: "info", label: "À traiter" },
  APPROVED: { type: "success", label: "Validé" },
  REJECTED: { type: "danger", label: "Refusé" },
};

export default function AdminCouriersPage() {
  const [filter, setFilter] = useState("PENDING");
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCouriers(
        await apiFetch<Courier[]>(`/admin/couriers${filter ? `?status=${filter}` : ""}`),
      );
    } catch {
      setCouriers([]);
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
      const answer = window.prompt("Motif du refus (transmis au livreur) :");
      if (!answer?.trim()) return;
      reason = answer.trim();
    }

    setError(null);
    try {
      await apiFetch(`/admin/couriers/${id}/review`, {
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
        title="Dossiers livreurs"
        subtitle="Sans livreur validé, aucune commande ne quitte l’atelier."
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
      ) : couriers.length === 0 ? (
        <Panel>
          <EmptyState title="Rien à traiter" text="Aucun dossier ne correspond à ce filtre." />
        </Panel>
      ) : (
        couriers.map((courier) => (
          <CourierCard key={courier.id} courier={courier} onReview={review} />
        ))
      )}
    </>
  );
}

function CourierCard({
  courier,
  onReview,
}: {
  courier: Courier;
  onReview: (id: string, decision: "APPROVE" | "REJECT") => Promise<void>;
}) {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDocuments = async () => {
    setBusy(true);
    setDocuments(
      await apiFetch<Document[]>(`/admin/couriers/${courier.id}/documents`).catch(() => []),
    );
    setBusy(false);
  };

  const state = STATE[courier.kycStatus];

  return (
    <Panel title={courier.fullName} action={<Badge type={state.type}>{state.label}</Badge>}>
      <dl className={admin.details}>
        <div>
          <dt>Véhicule</dt>
          <dd>{VEHICLES[courier.vehicle] ?? courier.vehicle}</dd>
        </div>
        <div>
          <dt>Immatriculation</dt>
          <dd>{courier.plateNumber ?? ""}</dd>
        </div>
        <div>
          <dt>Mobile Money</dt>
          <dd>{courier.payoutMsisdn ?? ""}</dd>
        </div>
        <div>
          <dt>Courses livrées</dt>
          <dd>{courier.deliveredCount}</dd>
        </div>
        <div>
          <dt>Déposé le</dt>
          <dd>
            {courier.kycSubmittedAt
              ? new Date(courier.kycSubmittedAt).toLocaleDateString("fr-FR")
              : ""}
          </dd>
        </div>
        <div>
          <dt>Disponibilité</dt>
          <dd>{courier.isAvailable ? "Disponible" : "Indisponible"}</dd>
        </div>
      </dl>

      {courier.kycRejectReason ? (
        <p className={styles.muted}>Dernier refus : {courier.kycRejectReason}</p>
      ) : null}

      {documents === null ? (
        <Button type="button" variant="outline" onClick={() => void loadDocuments()} disabled={busy}>
          {busy ? "Ouverture…" : "Voir les pièces (identité, permis, carte grise)"}
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

      {courier.kycStatus !== "APPROVED" ? (
        <div className={styles.rowActions}>
          <Button type="button" variant="outline" onClick={() => void onReview(courier.id, "REJECT")}>
            Refuser
          </Button>
          <Button type="button" onClick={() => void onReview(courier.id, "APPROVE")}>
            Valider le livreur
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
