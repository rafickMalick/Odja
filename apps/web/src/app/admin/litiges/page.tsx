"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
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
 * Arbitrage des réclamations.
 *
 * Trois décisions distinctes se prennent ici, et l'écran refuse de les
 * confondre :
 *
 *   · **rembourser ou rejeter**  c'est la réponse au client ;
 *   · **rendre aussi les frais de livraison**  geste commercial, faux par
 *     défaut, parce que la règle du cahier retient livraison et commission ;
 *   · **qui supporte la perte**  le créateur ou Ojà. Sans cette question,
 *     un artisan se verrait débiter une casse survenue en transit.
 *
 * Aucune de ces trois n'a de valeur implicite : les laisser à un réglage
 * silencieux, c'est décider à la place de l'équipe.
 */

interface Message {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: string;
}

interface Dispute {
  reference: string;
  orderReference: string;
  subOrderReference: string | null;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
  statusLabel: string;
  reasonLabel: string;
  resolution: string | null;
  refundXof: number | null;
  slaDueAt: string;
  overdue: boolean;
  messages: Message[];
  createdAt: string;
}

const TONE: Record<string, "pending" | "success" | "info" | "warning" | "danger"> = {
  OPEN: "warning",
  UNDER_REVIEW: "info",
  RESOLVED: "success",
  REJECTED: "danger",
};

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDisputes(
        await apiFetch<Dispute[]>(`/admin/disputes${openOnly ? "?open=true" : ""}`),
      );
    } catch {
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }, [openOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdue = disputes.filter((dispute) => dispute.overdue).length;

  return (
    <>
      <PageHead
        title="Réclamations"
        subtitle={
          overdue > 0
            ? `${overdue} dossier${overdue > 1 ? "s" : ""} hors délai de traitement.`
            : "Chaque partie parle à Ojà, jamais l’une à l’autre."
        }
      />

      <div className={admin.filters}>
        <button
          type="button"
          className={openOnly ? admin.filterActive : admin.filter}
          onClick={() => setOpenOnly(true)}
        >
          En cours
        </button>
        <button
          type="button"
          className={!openOnly ? admin.filterActive : admin.filter}
          onClick={() => setOpenOnly(false)}
        >
          Toutes
        </button>
      </div>

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : disputes.length === 0 ? (
        <Panel>
          <EmptyState title="Aucune réclamation" text="Rien n’attend d’arbitrage." />
        </Panel>
      ) : (
        disputes.map((dispute) => (
          <DisputeCard key={dispute.reference} dispute={dispute} onResolved={load} />
        ))
      )}
    </>
  );
}

function DisputeCard({
  dispute,
  onResolved,
}: {
  dispute: Dispute;
  onResolved: () => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"REFUND" | "REJECT">("REFUND");
  const [refundDelivery, setRefundDelivery] = useState(false);
  const [chargeToMaker, setChargeToMaker] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = dispute.status === "RESOLVED" || dispute.status === "REJECTED";

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/disputes/${dispute.reference}/messages`, {
        method: "POST",
        body: { body: reply },
      });
      setReply("");
      await onResolved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/admin/disputes/${dispute.reference}/resolve`, {
        method: "POST",
        body: {
          decision,
          note,
          refundDelivery: decision === "REFUND" ? refundDelivery : false,
          chargeToMaker,
        },
      });
      await onResolved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Décision impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={`${dispute.reference} · ${dispute.reasonLabel}`}
      action={
        <>
          {dispute.overdue ? <Badge type="danger">Hors délai</Badge> : null}{" "}
          <Badge type={TONE[dispute.status] ?? "pending"}>{dispute.statusLabel}</Badge>
        </>
      }
    >
      <dl className={admin.details}>
        <div>
          <dt>Commande</dt>
          <dd>{dispute.orderReference}</dd>
        </div>
        <div>
          <dt>Sous-commande</dt>
          <dd>{dispute.subOrderReference ?? "Aucune"}</dd>
        </div>
        <div>
          <dt>Ouverte le</dt>
          <dd>{new Date(dispute.createdAt).toLocaleDateString("fr-FR")}</dd>
        </div>
        <div>
          <dt>À traiter avant</dt>
          <dd>{new Date(dispute.slaDueAt).toLocaleDateString("fr-FR")}</dd>
        </div>
      </dl>

      <ul className={admin.documents}>
        {dispute.messages.map((message) => (
          <li key={message.id}>
            <span>
              <strong>{message.fromAdmin ? "Ojà" : "Le plaignant"}</strong> : {message.body}
            </span>
            <span className={styles.muted}>
              {new Date(message.createdAt).toLocaleDateString("fr-FR")}
            </span>
          </li>
        ))}
      </ul>

      {error ? <p className={styles.error}>{error}</p> : null}

      {closed ? (
        <p className={styles.muted}>
          {dispute.resolution}
          {dispute.refundXof !== null
            ? ` · remboursé : ${formatFcfa(dispute.refundXof)}`
            : ""}
        </p>
      ) : (
        <>
          <Field label="Répondre au plaignant">
            <textarea
              className={fieldStyles.control}
              rows={2}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Demander une photo, une précision…"
            />
          </Field>
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              disabled={busy || reply.trim().length === 0}
              onClick={() => void send()}
            >
              Envoyer le message
            </Button>
          </div>

          <h3 className={styles.panelTitle}>Trancher</h3>

          <Field label="Décision">
            <select
              className={fieldStyles.control}
              value={decision}
              onChange={(event) => setDecision(event.target.value as "REFUND" | "REJECT")}
            >
              <option value="REFUND">Rembourser le client</option>
              <option value="REJECT">Rejeter la réclamation</option>
            </select>
          </Field>

          <Field label="Motivation (transmise aux deux parties)">
            <textarea
              className={fieldStyles.control}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {decision === "REFUND" ? (
            <label className={admin.check}>
              <input
                type="checkbox"
                checked={refundDelivery}
                onChange={(event) => setRefundDelivery(event.target.checked)}
              />
              <span>
                Rendre aussi les frais de livraison (geste commercial, hors règle habituelle)
              </span>
            </label>
          ) : null}

          <label className={admin.check}>
            <input
              type="checkbox"
              checked={chargeToMaker}
              onChange={(event) => setChargeToMaker(event.target.checked)}
            />
            <span>
              Imputer la perte au créateur (décochez si la casse est survenue en transit)
            </span>
          </label>

          <div className={styles.rowActions}>
            <Button
              type="button"
              disabled={busy || note.trim().length < 4}
              onClick={() => void resolve()}
            >
              {busy ? "…" : "Clore la réclamation"}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
