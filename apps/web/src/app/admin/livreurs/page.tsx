"use client";

import type { IncompleteCourierView, UnassignedShipmentView } from "@oja/contracts";
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
import { formatFcfa } from "@/lib/format";

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

interface CourierCash {
  courierId: string;
  fullName: string;
  cashHeldXof: number;
}

interface Document {
  id: string;
  type: string;
  status: string;
  url?: string;
}

/** Filtre à part : ces livreurs n'ont pas encore de dossier à juger. */
const INCOMPLETE = "INCOMPLETE";

const FILTERS = [
  { value: "PENDING", label: "À traiter" },
  { value: INCOMPLETE, label: "Inscrits, dossier incomplet" },
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
  const [cash, setCash] = useState<CourierCash[]>([]);
  const [incomplete, setIncomplete] = useState<IncompleteCourierView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCash = useCallback(async () => {
    setCash(await apiFetch<CourierCash[]>("/admin/couriers/cash").catch(() => []));
  }, []);

  useEffect(() => {
    void loadCash();
  }, [loadCash]);

  /* Le livreur a remis des espèces à l'équipe : on l'enregistre. Le serveur
     refuse un montant supérieur à ce qu'il détient. */
  const remit = async (row: CourierCash) => {
    const answer = window.prompt(
      `Montant reversé par ${row.fullName} (F CFA, au plus ${row.cashHeldXof}) :`,
      String(row.cashHeldXof),
    );
    if (!answer) return;
    const amountXof = Number(answer.replace(/\s/g, ""));
    if (!Number.isInteger(amountXof) || amountXof <= 0) {
      setError("Saisissez un montant entier positif.");
      return;
    }

    setError(null);
    try {
      await apiFetch(`/admin/couriers/${row.courierId}/remittance`, {
        method: "POST",
        body: { amountXof },
      });
      await loadCash();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Enregistrement impossible.");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      if (filter === INCOMPLETE) {
        setIncomplete(await apiFetch<IncompleteCourierView[]>("/admin/couriers/incomplete"));
        setCouriers([]);
      } else {
        setCouriers(
          await apiFetch<Courier[]>(`/admin/couriers${filter ? `?status=${filter}` : ""}`),
        );
      }
    } catch {
      setCouriers([]);
      setIncomplete([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const remind = async (row: IncompleteCourierView) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/admin/couriers/incomplete/${row.userId}/remind`, { method: "POST" });
      setNotice(`Rappel envoyé à ${row.fullName} (${row.email}).`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi du rappel impossible.");
    }
  };

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

      {cash.length > 0 ? (
        <Panel title="Espèces à récupérer auprès des livreurs">
          <dl className={admin.details}>
            {cash.map((row) => (
              <div key={row.courierId}>
                <dt>{row.fullName}</dt>
                <dd>
                  {formatFcfa(row.cashHeldXof)}{" "}
                  <Button type="button" variant="outline" onClick={() => void remit(row)}>
                    Enregistrer un reversement
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
          <p className={styles.muted}>
            Argent encaissé à la livraison pour le compte d’Ojà (paiement à la livraison ou solde
            d’un acompte), pas encore remis à l’équipe.
          </p>
        </Panel>
      ) : null}

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
      {notice ? (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : filter === INCOMPLETE ? (
        incomplete.length === 0 ? (
          <Panel>
            <EmptyState
              title="Aucun dossier en attente de pièces"
              text="Tous les livreurs inscrits ont déposé leur dossier."
            />
          </Panel>
        ) : (
          <Panel title="Inscrits dont le dossier n’est pas déposé">
            <p className={styles.muted}>
              Ils apparaissent ici dès l’inscription. Une fois leurs pièces déposées, ils passent
              dans « À traiter », où vous les validez ou les refusez.
            </p>
            <dl className={admin.details}>
              {incomplete.map((row) => (
                <div key={row.userId}>
                  <dt>{row.fullName}</dt>
                  <dd>
                    <span className={styles.muted}>
                      {row.email} · inscrit le{" "}
                      {new Date(row.registeredAt).toLocaleDateString("fr-FR")}
                    </span>
                    <br />
                    Manque : {row.missing.join(", ")}{" "}
                    <Button type="button" variant="outline" onClick={() => void remind(row)}>
                      Relancer par e-mail
                    </Button>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        )
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

  /* Affecter une course depuis la fiche du livreur : seules les expéditions
     en attente que son véhicule peut porter sont proposées. */
  const [assignable, setAssignable] = useState<UnassignedShipmentView[] | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  const loadAssignable = async () => {
    setBusy(true);
    setAssignMessage(null);
    setAssignable(
      await apiFetch<UnassignedShipmentView[]>(
        `/admin/couriers/${courier.id}/assignable-shipments`,
      ).catch(() => []),
    );
    setBusy(false);
  };

  const assign = async (shipment: UnassignedShipmentView) => {
    setBusy(true);
    try {
      await apiFetch(`/admin/logistics/shipments/${shipment.reference}/assign`, {
        method: "POST",
        body: { courierId: courier.id },
      });
      setAssignMessage(
        `Course ${shipment.reference} (commande ${shipment.orderReference}) confiée à ${courier.fullName}.`,
      );
      setAssignable((current) =>
        current ? current.filter((item) => item.reference !== shipment.reference) : current,
      );
    } catch (cause) {
      setAssignMessage(cause instanceof ApiError ? cause.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={courier.fullName} action={<Badge type={state.type}>{state.label}</Badge>}>
      <dl className={admin.details}>
        <div>
          <dt>Véhicule</dt>
          <dd>{VEHICLES[courier.vehicle] ?? courier.vehicle}</dd>
        </div>
        <div>
          <dt>Immatriculation</dt>
          <dd>{courier.plateNumber ?? "Non renseigné"}</dd>
        </div>
        <div>
          <dt>Mobile Money</dt>
          <dd>{courier.payoutMsisdn ?? "Non renseigné"}</dd>
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
              : "Pas encore déposé"}
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

      {courier.kycStatus === "APPROVED" ? (
        assignable === null ? (
          <div className={styles.rowActions}>
            <Button type="button" onClick={() => void loadAssignable()} disabled={busy}>
              Lui affecter une course
            </Button>
          </div>
        ) : (
          <>
            {assignable.length === 0 ? (
              <p className={styles.muted}>
                Aucune course en attente que son véhicule puisse prendre.
              </p>
            ) : (
              <ul className={admin.documents}>
                {assignable.map((shipment) => (
                  <li key={shipment.reference}>
                    <span>
                      {shipment.orderReference} · {shipment.shopName} · {shipment.pickupLine1} →{" "}
                      {shipment.dropLine1} · {shipment.distanceKm.toFixed(1)} km ·{" "}
                      {VEHICLES[shipment.vehicle] ?? shipment.vehicle}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void assign(shipment)}
                      disabled={busy}
                    >
                      Affecter
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      ) : null}
      {assignMessage ? (
        <p className={styles.muted} role="status">
          {assignMessage}
        </p>
      ) : null}

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
