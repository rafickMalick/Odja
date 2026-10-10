"use client";

import type { AdminExhibition, AdminPassView, ExhibitionStats, PrivateFileLink } from "@oja/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow } from "@/components/Field";
import { PageHead, Panel, StatTile, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { ACCESS_LABELS, FORMAT_LABELS, STATUS_LABELS, STATUS_TONE, dateRange } from "@/lib/exhibitions";
import { formatFcfa } from "@/lib/format";

import admin from "../../admin.module.css";

/**
 * Instruction d'une exposition (§ 6.4, 6.5, 11.3 à 11.5).
 *
 * Tout le circuit sur une page : examen du dossier et des œuvres, décision,
 * contrat, paiement, programmation, mise en avant, suspension ; puis les
 * chiffres — visites, billets, ventes.
 */
export default function AdminExhibitionPage() {
  const { id } = useParams<{ id: string }>();
  const [exhibition, setExhibition] = useState<AdminExhibition | null>(null);
  const [stats, setStats] = useState<ExhibitionStats | null>(null);
  const [passes, setPasses] = useState<AdminPassView[]>([]);
  const [files, setFiles] = useState<PrivateFileLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contractRef, setContractRef] = useState("");
  const [payment, setPayment] = useState({ amount: "", reference: "" });
  const [publishAt, setPublishAt] = useState("");

  const load = useCallback(async () => {
    const [detail, numbers, list] = await Promise.all([
      apiFetch<AdminExhibition>(`/admin/exhibitions/${id}`),
      apiFetch<ExhibitionStats>(`/admin/exhibitions/${id}/stats`).catch(() => null),
      apiFetch<AdminPassView[]>(`/admin/exhibitions/${id}/passes`).catch(() => []),
    ]);
    setExhibition(detail);
    setStats(numbers);
    setPasses(list);
    setContractRef(detail.contractReference ?? "");
    if (detail.plan && !payment.amount) {
      setPayment((current) => ({ ...current, amount: String(detail.plan?.priceXof ?? "") }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError("Exposition introuvable."));
  }, [load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      setExhibition(
        await apiFetch<AdminExhibition>(`/admin/exhibitions/${id}${path}`, {
          method: "POST",
          ...(body !== undefined ? { body } : {}),
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  const decide = (decision: "ACCEPT" | "REJECT" | "REQUEST_CHANGES") => {
    let note: string | undefined;
    if (decision !== "ACCEPT") {
      const answer = window.prompt(
        decision === "REJECT" ? "Motif du refus (transmis à l’organisateur) :" : "Modifications demandées :",
      );
      if (!answer?.trim()) return;
      note = answer.trim();
    }
    void act("/review", { decision, ...(note ? { note } : {}) });
  };

  const reviewWork = (workId: string, decision: "APPROVE" | "REJECT") => {
    let note: string | undefined;
    if (decision === "REJECT") {
      const answer = window.prompt("Pourquoi cette œuvre n’est-elle pas retenue ?");
      if (!answer?.trim()) return;
      note = answer.trim();
    }
    void act(`/works/${workId}/review`, { decision, ...(note ? { note } : {}) });
  };

  if (error && !exhibition) return <p className={styles.error}>{error}</p>;
  if (!exhibition) return <p className={styles.muted}>Chargement…</p>;

  const accepted = ["ACCEPTED", "SCHEDULED", "PUBLISHED", "SUSPENDED"].includes(exhibition.status);

  return (
    <>
      <PageHead
        title={exhibition.title}
        subtitle={`${exhibition.organizerName} · ${exhibition.organizerEmail}`}
        action={<Badge type={STATUS_TONE[exhibition.status]}>{STATUS_LABELS[exhibition.status]}</Badge>}
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      {stats ? (
        <div className={styles.statGrid}>
          <StatTile label="Visites de la page" value={String(stats.views)} />
          <StatTile
            label="Billets"
            value={String(stats.ticketsConfirmed)}
            hint={`${formatFcfa(stats.ticketRevenueXof)} encaissés · ${stats.ticketsPending} en attente`}
          />
          <StatTile label="Inscriptions et invitations" value={String(stats.registrations + stats.invitations)} />
          <StatTile
            label="Œuvres vendues"
            value={String(stats.worksSold)}
            hint={`${formatFcfa(stats.salesXof)} · ${stats.ordersCount} commande(s)`}
          />
        </div>
      ) : null}

      <Panel title="Dossier">
        <dl className={admin.details}>
          <div>
            <dt>Dates</dt>
            <dd>{dateRange(exhibition.startsAt, exhibition.endsAt)}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{FORMAT_LABELS[exhibition.format]}</dd>
          </div>
          <div>
            <dt>Ville</dt>
            <dd>{exhibition.city}</dd>
          </div>
          <div>
            <dt>Lieu</dt>
            <dd>{exhibition.venueName ? `${exhibition.venueName}, ${exhibition.venueAddress ?? ""}` : "—"}</dd>
          </div>
          <div>
            <dt>Formule</dt>
            <dd>{exhibition.plan ? `${exhibition.plan.name} · ${formatFcfa(exhibition.plan.priceXof)}` : "—"}</dd>
          </div>
          <div>
            <dt>Accès</dt>
            <dd>
              {ACCESS_LABELS[exhibition.accessMode]}
              {exhibition.accessMode === "PAID" ? ` · ${formatFcfa(exhibition.ticketPriceXof)}` : ""}
            </dd>
          </div>
          <div>
            <dt>Organisateur</dt>
            <dd>{exhibition.organizerRole === "MAKER" ? "Créateur inscrit" : "Organisateur externe"}</dd>
          </div>
          <div>
            <dt>Vente des œuvres</dt>
            <dd>{exhibition.canSellWorks ? "Possible (boutique validée)" : "Présentation seulement"}</dd>
          </div>
        </dl>
        <p className={styles.muted}>{exhibition.summary}</p>
        {files === null ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void apiFetch<PrivateFileLink[]>(`/admin/exhibitions/${id}/files`).then(setFiles).catch(() => setFiles([]))}
          >
            Ouvrir le dossier et les justificatifs
          </Button>
        ) : files.length === 0 ? (
          <p className={styles.muted}>Aucune pièce jointe.</p>
        ) : (
          <ul className={admin.documents}>
            {files.map((file) => (
              <li key={file.url}>
                <span>{file.label}</span>
                <a href={file.url} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Œuvres (${exhibition.works.length})`}>
        <ul className={admin.documents}>
          {exhibition.works.map((work) => (
            <li key={work.id}>
              <span>
                <strong>{work.title}</strong> — {work.artistName}
                {work.productName ? ` · en vente : ${work.productName}` : ""}
                {work.hasProof ? " · justificatif joint" : ""}
                {work.imageUrls.length > 0 ? ` · ${work.imageUrls.length} photo(s)` : " · sans photo"}
                {work.reviewNote ? <span className={styles.muted}> — {work.reviewNote}</span> : null}
              </span>
              <span className={styles.rowActions}>
                {work.reviewStatus === "PENDING" ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => reviewWork(work.id, "REJECT")}>
                      Refuser
                    </Button>
                    <Button type="button" disabled={busy} onClick={() => reviewWork(work.id, "APPROVE")}>
                      Valider
                    </Button>
                  </>
                ) : (
                  <Badge type={work.reviewStatus === "APPROVED" ? "success" : "danger"}>
                    {work.reviewStatus === "APPROVED" ? "Validée" : "Refusée"}
                  </Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {exhibition.status === "SUBMITTED" ? (
        <Panel title="Décision">
          <div className={styles.rowActions}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => decide("REQUEST_CHANGES")}>
              Demander des modifications
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => decide("REJECT")}>
              Refuser
            </Button>
            <Button type="button" disabled={busy} onClick={() => decide("ACCEPT")}>
              Accepter le projet
            </Button>
          </div>
        </Panel>
      ) : null}

      {accepted ? (
        <Panel title="Contrat, paiement et mise en ligne">
          <FieldRow>
            <Field label="Référence du contrat" value={contractRef} onChange={(e) => setContractRef(e.target.value)} />
          </FieldRow>
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              disabled={busy || Boolean(exhibition.contractSentAt)}
              onClick={() => void act("/contract", { sent: true, ...(contractRef ? { contractReference: contractRef } : {}) })}
            >
              {exhibition.contractSentAt ? "Contrat envoyé ✓" : "Marquer le contrat envoyé"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || Boolean(exhibition.contractSignedAt)}
              onClick={() => void act("/contract", { signed: true, ...(contractRef ? { contractReference: contractRef } : {}) })}
            >
              {exhibition.contractSignedAt ? "Contrat signé ✓" : "Marquer le contrat signé"}
            </Button>
          </div>

          <FieldRow>
            <Field
              label="Montant reçu (F CFA)"
              inputMode="numeric"
              value={payment.amount}
              onChange={(e) => setPayment({ ...payment, amount: e.target.value.replace(/\D/g, "") })}
            />
            <Field
              label="Référence du paiement"
              value={payment.reference}
              onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
            />
          </FieldRow>
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !payment.reference.trim()}
              onClick={() => void act("/payment", { amountXof: Number(payment.amount) || 0, reference: payment.reference.trim() })}
            >
              {exhibition.paymentReceivedAt ? "Paiement reçu ✓ — corriger" : "Enregistrer le paiement"}
            </Button>
          </div>

          {exhibition.status === "ACCEPTED" ? (
            <>
              {exhibition.scheduleBlockers.length > 0 ? (
                <p className={styles.muted}>Avant de programmer : {exhibition.scheduleBlockers.join(", ")}.</p>
              ) : null}
              <FieldRow>
                <Field label="Mise en ligne le" type="date" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
              </FieldRow>
              <div className={styles.rowActions}>
                <Button
                  type="button"
                  disabled={busy || !publishAt || exhibition.scheduleBlockers.length > 0}
                  onClick={() => void act("/schedule", { publishAt: new Date(`${publishAt}T07:00:00`).toISOString() })}
                >
                  Programmer la mise en ligne
                </Button>
              </div>
            </>
          ) : null}

          <div className={styles.rowActions}>
            {exhibition.status === "SCHEDULED" || exhibition.status === "SUSPENDED" ? (
              <Button type="button" disabled={busy} onClick={() => void act("/publish")}>
                {exhibition.status === "SUSPENDED" ? "Remettre en ligne" : "Publier maintenant"}
              </Button>
            ) : null}
            {exhibition.status === "PUBLISHED" || exhibition.status === "SCHEDULED" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Motif de la suspension (transmis à l’organisateur) :");
                  if (reason?.trim()) void act("/suspend", { reason: reason.trim() });
                }}
              >
                Suspendre
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={busy} onClick={() => void act("/feature", { isFeatured: !exhibition.isFeatured })}>
              {exhibition.isFeatured ? "Retirer de la une" : "Mettre à la une"}
            </Button>
            {exhibition.status === "PUBLISHED" ? (
              <Link href={`/expositions/${exhibition.slug}`} target="_blank">
                Voir la page publique
              </Link>
            ) : null}
          </div>
          {exhibition.suspendReason ? <p className={styles.muted}>Suspendue : {exhibition.suspendReason}</p> : null}
        </Panel>
      ) : null}

      {passes.length > 0 ? (
        <Panel title={`Accès des visiteurs (${passes.length})`}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Visiteur</th>
                  <th>Type</th>
                  <th>Format</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {passes.map((pass) => (
                  <tr key={pass.reference}>
                    <td>{pass.reference}</td>
                    <td>
                      {pass.holderName}
                      <p className={styles.muted}>{pass.holderEmail}</p>
                    </td>
                    <td>
                      {pass.kind === "TICKET" ? `Billet ${formatFcfa(pass.amountXof)}` : pass.kind === "REGISTRATION" ? "Inscription" : "Invitation"}
                    </td>
                    <td>{pass.format === "ONSITE" ? "Sur place" : "En ligne"}</td>
                    <td>
                      <Badge type={pass.status === "CONFIRMED" ? "success" : pass.status === "PENDING_PAYMENT" ? "pending" : "danger"}>
                        {pass.status === "CONFIRMED" ? "Confirmé" : pass.status === "PENDING_PAYMENT" ? "Paiement en attente" : "Annulé"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
