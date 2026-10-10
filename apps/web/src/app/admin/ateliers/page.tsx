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
import type {
  CreatorKind,
  MakerPlanSummary,
  MakerSubscriptionView,
  VisibilityPlanView,
} from "@oja/contracts";

import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { ApiError, apiFetch } from "@/lib/api";
import { CREATOR_KIND_LABELS } from "@/lib/creators";
import { formatFcfa } from "@/lib/format";

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
  creatorKind: CreatorKind;
  plan: MakerPlanSummary;
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
  const [plans, setPlans] = useState<VisibilityPlanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<VisibilityPlanView[]>("/admin/visibility-plans")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

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
          <MakerCard
            key={maker.id}
            maker={maker}
            plans={plans}
            onReview={review}
            onPlanChange={load}
          />
        ))
      )}
    </>
  );
}

function MakerCard({
  maker,
  plans,
  onReview,
  onPlanChange,
}: {
  maker: AdminMaker;
  plans: VisibilityPlanView[];
  onReview: (id: string, decision: "APPROVE" | "REJECT") => Promise<void>;
  onPlanChange: () => Promise<void>;
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
        <div>
          <dt>Statut</dt>
          <dd>{CREATOR_KIND_LABELS[maker.creatorKind]}</dd>
        </div>
        <div>
          <dt>Formule</dt>
          <dd>
            {maker.plan.name}
            {maker.plan.endsAt
              ? ` · jusqu’au ${new Date(maker.plan.endsAt).toLocaleDateString("fr-FR")}`
              : ""}
          </dd>
        </div>
      </dl>

      {maker.kycStatus === "APPROVED" ? (
        <VisibilityManager makerId={maker.id} plans={plans} onChange={onPlanChange} />
      ) : null}

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

/**
 * Formule de visibilité d'un atelier.
 *
 * Tant que le paiement en ligne du Premium n'existe pas, l'agent active la
 * formule après avoir reçu le règlement, et note la référence du paiement :
 * c'est ce qui permettra de rapprocher les deux en comptabilité.
 */
function VisibilityManager({
  makerId,
  plans,
  onChange,
}: {
  makerId: string;
  plans: VisibilityPlanView[];
  onChange: () => Promise<void>;
}) {
  const grantable = plans.filter((plan) => plan.isActive && !plan.isDefault);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<MakerSubscriptionView[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [amountXof, setAmountXof] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (!open && history === null) {
      setHistory(
        await apiFetch<MakerSubscriptionView[]>(`/admin/makers/${makerId}/subscriptions`).catch(
          () => [],
        ),
      );
    }
    setOpen((current) => !current);
  };

  const choosePlan = (id: string) => {
    setPlanId(id);
    const plan = grantable.find((item) => item.id === id);
    setDurationDays(plan?.durationDays ? String(plan.durationDays) : "");
    setAmountXof(plan && plan.priceXof > 0 ? String(plan.priceXof) : "");
  };

  const grant = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    try {
      setHistory(
        await apiFetch<MakerSubscriptionView[]>(`/admin/makers/${makerId}/subscriptions`, {
          method: "POST",
          body: {
            planId,
            amountXof: Number(amountXof) || 0,
            ...(durationDays ? { durationDays: Number(durationDays) } : {}),
            ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      );
      setPlanId("");
      setPaymentReference("");
      setNote("");
      await onChange();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (subscriptionId: string) => {
    if (!window.confirm("Résilier cette période ? L’atelier repasse à la formule par défaut.")) return;
    setBusy(true);
    setError(null);
    try {
      setHistory(
        await apiFetch<MakerSubscriptionView[]>(
          `/admin/makers/${makerId}/subscriptions/${subscriptionId}/cancel`,
          { method: "POST" },
        ),
      );
      await onChange();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Résiliation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={admin.visibility}>
      <Button type="button" variant="outline" onClick={() => void toggle()}>
        {open ? "Fermer la formule" : "Gérer la formule"}
      </Button>

      {open ? (
        <>
          {history && history.length > 0 ? (
            <ul className={admin.documents}>
              {history.map((period) => (
                <li key={period.id}>
                  <span>
                    {period.plan.name} · du {new Date(period.startsAt).toLocaleDateString("fr-FR")}
                    {period.endsAt
                      ? ` au ${new Date(period.endsAt).toLocaleDateString("fr-FR")}`
                      : ""}
                    {period.amountXof > 0 ? ` · ${formatFcfa(period.amountXof)}` : ""}
                    {period.paymentReference ? ` · réf. ${period.paymentReference}` : ""}
                  </span>
                  {period.cancelledAt ? (
                    <Badge type="danger">Résiliée</Badge>
                  ) : period.active ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void cancel(period.id)}
                    >
                      Résilier
                    </Button>
                  ) : (
                    <Badge type="pending">Terminée</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Aucune formule payante jusqu’ici.</p>
          )}

          {grantable.length > 0 ? (
            <>
              <FieldRow>
                <Field label="Formule à activer">
                  <select
                    className={fieldStyles.control}
                    value={planId}
                    onChange={(event) => choosePlan(event.target.value)}
                  >
                    <option value="">Choisir</option>
                    {grantable.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Durée, en jours"
                  inputMode="numeric"
                  value={durationDays}
                  onChange={(event) => setDurationDays(event.target.value.replace(/\D/g, ""))}
                />
              </FieldRow>
              <FieldRow>
                <Field
                  label="Montant reçu (F CFA)"
                  inputMode="numeric"
                  value={amountXof}
                  onChange={(event) => setAmountXof(event.target.value.replace(/\D/g, ""))}
                />
                <Field
                  label="Référence du paiement"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Transaction Mobile Money, virement…"
                />
              </FieldRow>
              <Field
                label="Note interne (facultatif)"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className={styles.rowActions}>
                <Button type="button" disabled={!planId || busy} onClick={() => void grant()}>
                  {busy ? "Activation…" : "Activer la formule"}
                </Button>
              </div>
            </>
          ) : (
            <p className={styles.muted}>
              Aucune formule payante active. Créez-en une dans « Formules de visibilité ».
            </p>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
