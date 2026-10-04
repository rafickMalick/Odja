"use client";

import type { OwnReviewView, ReviewStatus } from "@oja/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { Stars, StarsInput } from "@/components/Stars";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import { ORDER_TONE, SUB_ORDER_TONE } from "../../status";
import { DeliveryTracker } from "./DeliveryTracker";
import order from "./order.module.css";

/**
 * Détail d'une commande.
 *
 * Le cahier client tient en deux boutons : « Valider la réception » ou
 * « Signaler un problème ». C'est ce clic qui décide si l'argent part au
 * créateur ou revient au client  il est donc présenté **par colis**, pas par
 * commande : une commande chez deux ateliers arrive en deux fois, et l'une des
 * deux pièces peut être parfaite quand l'autre est cassée.
 */

interface Line {
  id: string;
  productName: string;
  productSlug: string;
  quantity: number;
  finalPriceXof: number;
  lineTotalXof: number;
  canReview: boolean;
  review: OwnReviewView | null;
}

interface SubOrder {
  reference: string;
  shopName: string;
  status: string;
  statusLabel: string;
  lines: Line[];
  deliveryFeeXof: number;
  vehicle: string | null;
  dueReadyAt: string | null;
  shipmentReference: string | null;
}

interface Order {
  reference: string;
  status: string;
  statusLabel: string;
  shipFullName: string;
  shipPhone: string;
  shipLine1: string;
  shipLandmark: string | null;
  subOrders: SubOrder[];
  itemsFinalTotalXof: number;
  deliveryTotalXof: number;
  vatXof: number;
  discountXof: number;
  promoCode: string | null;
  totalXof: number;
  placedAt: string | null;
  hasInvoice?: boolean;
}

const PROBLEMS = [
  { value: "non_conforme", label: "La pièce ne correspond pas à l’annonce" },
  { value: "casse", label: "La pièce est cassée ou abîmée" },
  { value: "incomplet", label: "Il manque des éléments" },
  { value: "autre", label: "Autre problème" },
];

export default function OrderDetailPage() {
  const params = useParams<{ reference: string }>();
  const router = useRouter();

  const [data, setData] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Order>(`/orders/${params.reference}`));
    } catch {
      setError("Cette commande est introuvable.");
    }
  }, [params.reference]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Chargement…</p>;

  return (
    <>
      <PageHead
        title={data.reference}
        subtitle={
          data.placedAt
            ? `Commandée le ${new Date(data.placedAt).toLocaleDateString("fr-FR")}`
            : undefined
        }
        action={<Badge type={ORDER_TONE[data.status] ?? "pending"}>{data.statusLabel}</Badge>}
      />

      {data.subOrders.map((subOrder) => (
        <SubOrderPanel
          key={subOrder.reference}
          subOrder={subOrder}
          onChanged={async () => {
            await load();
            router.refresh();
          }}
        />
      ))}

      <Panel title="Livraison">
        <div className={order.rows}>
          <div>
            <span>Destinataire</span>
            <strong>{data.shipFullName}</strong>
          </div>
          <div>
            <span>Téléphone</span>
            <strong>{data.shipPhone}</strong>
          </div>
          <div>
            <span>Adresse</span>
            <strong>{data.shipLine1}</strong>
          </div>
          {data.shipLandmark ? (
            <div>
              <span>Repère</span>
              <strong>{data.shipLandmark}</strong>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Total">
        <div className={order.rows}>
          <div>
            <span>Pièces</span>
            <strong>{formatFcfa(data.itemsFinalTotalXof)}</strong>
          </div>
          <div>
            <span>
              Livraison{" "}
              {data.subOrders.length > 1 ? `(${data.subOrders.length} ateliers)` : ""}
            </span>
            <strong>{formatFcfa(data.deliveryTotalXof)}</strong>
          </div>
          {data.vatXof > 0 ? (
            <div>
              <span>TVA</span>
              <strong>{formatFcfa(data.vatXof)}</strong>
            </div>
          ) : null}
          {data.discountXof > 0 ? (
            <div>
              <span>Remise{data.promoCode ? ` (${data.promoCode})` : ""}</span>
              <strong>− {formatFcfa(data.discountXof)}</strong>
            </div>
          ) : null}
          <div className={order.total}>
            {/* « Payé » seulement si l'argent est réellement arrivé : sur une
                commande en attente de paiement, le client croirait l'avoir
                réglée. */}
            <span>
              {data.status === "PENDING_PAYMENT"
                ? "À payer"
                : data.status === "CANCELLED"
                  ? "Total"
                  : "Payé"}
            </span>
            <strong>{formatFcfa(data.totalXof)}</strong>
          </div>
        </div>

        {data.hasInvoice ? <InvoiceButton reference={data.reference} /> : null}
      </Panel>
    </>
  );
}

function InvoiceButton({ reference }: { reference: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const invoice = await apiFetch<{ url: string; number: string }>(
        `/orders/${reference}/invoice`,
      );
      window.open(invoice.url, "_blank", "noopener");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Facture indisponible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: "0.9rem" }}>
      <Button variant="secondary" onClick={() => void download()} disabled={busy}>
        {busy ? "Préparation…" : "Télécharger la facture"}
      </Button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

function SubOrderPanel({
  subOrder,
  onChanged,
}: {
  subOrder: SubOrder;
  onChanged: () => Promise<void>;
}) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(PROBLEMS[0]!.value);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${subOrder.reference}/validate`, { method: "POST" });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Validation impossible.");
    } finally {
      setBusy(false);
    }
  };

  const report = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${subOrder.reference}/report-problem`, {
        method: "POST",
        body: { reason, description },
      });
      setReporting(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  const awaiting = subOrder.status === "DELIVERED";

  return (
    <Panel
      title={subOrder.shopName}
      action={
        <Badge type={SUB_ORDER_TONE[subOrder.status] ?? "pending"}>{subOrder.statusLabel}</Badge>
      }
    >
      <div className={order.rows}>
        {subOrder.lines.map((line, index) => (
          <div key={index}>
            <span>
              {line.productName} × {line.quantity}
            </span>
            <strong>{formatFcfa(line.lineTotalXof)}</strong>
          </div>
        ))}
        <div>
          <span>Livraison{subOrder.vehicle ? ` (${vehicleLabel(subOrder.vehicle)})` : ""}</span>
          <strong>{formatFcfa(subOrder.deliveryFeeXof)}</strong>
        </div>
      </div>

      {/* Réception validée : chaque pièce peut être notée, une fois. */}
      {subOrder.status === "VALIDATED" ? (
        <div className={order.form}>
          <p className={styles.muted}>
            <strong>Votre avis</strong> — il aide les autres acheteurs et l&apos;atelier. Il est
            publié après relecture par l&apos;équipe Ojà.
          </p>
          {subOrder.lines.map((line) => (
            <LineReview key={line.id} line={line} onChanged={onChanged} />
          ))}
        </div>
      ) : null}

      {subOrder.shipmentReference &&
      ["IN_DELIVERY", "DELIVERED", "VALIDATED"].includes(subOrder.status) ? (
        <DeliveryTracker reference={subOrder.shipmentReference} />
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {awaiting && !reporting ? (
        <>
          <p className={styles.muted}>
            Vérifiez la pièce avant de valider. Une fois validée, le règlement part au créateur
            et la commande est close.
          </p>
          <div className={styles.rowActions}>
            <Button type="button" variant="outline" onClick={() => setReporting(true)}>
              Signaler un problème
            </Button>
            <Button type="button" onClick={() => void validate()} disabled={busy}>
              {busy ? "…" : "Valider la réception"}
            </Button>
          </div>
        </>
      ) : null}

      {awaiting && reporting ? (
        <form onSubmit={report} className={order.form}>
          <Field label="Quel est le problème ?">
            <select
              className={fieldStyles.control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              {PROBLEMS.map((problem) => (
                <option key={problem.value} value={problem.value}>
                  {problem.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Décrivez-le">
            <textarea
              className={fieldStyles.control}
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ce que vous avez reçu, et en quoi cela diffère de l’annonce."
            />
          </Field>

          <p className={styles.muted}>
            Ojà ouvre une réclamation et examine votre demande. Le prix de la pièce vous est
            remboursé en cas d’accord ; les frais de livraison et la commission restent acquis.
          </p>

          <div className={styles.rowActions}>
            <Button type="button" variant="outline" onClick={() => setReporting(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || description.trim().length < 10}>
              {busy ? "…" : "Envoyer la réclamation"}
            </Button>
          </div>
        </form>
      ) : null}

      {subOrder.status === "VALIDATED" ? (
        <p className={styles.muted}>Réception confirmée. Merci.</p>
      ) : null}

      {subOrder.status === "REJECTED" || subOrder.status === "CANCELLED" ? (
        <p className={styles.muted}>
          Cette partie de la commande a été annulée et vous a été remboursée.{" "}
          <Link href="/compte/reclamations">Voir mes réclamations</Link>
        </p>
      ) : null}
    </Panel>
  );
}

function vehicleLabel(vehicle: string): string {
  return { MOTO: "moto", TRICYCLE: "tricycle", CAMIONNETTE: "camionnette" }[vehicle] ?? vehicle;
}

const REVIEW_STATUS: Record<ReviewStatus, string> = {
  PENDING: "en cours de relecture",
  PUBLISHED: "publié sur la fiche",
  REJECTED: "non retenu",
};

/** Avis sur une pièce reçue : le formulaire, ou l'avis déjà donné. */
function LineReview({ line, onChanged }: { line: Line; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (line.review) {
    return (
      <p className={styles.muted}>
        {line.productName} : <Stars value={line.review.rating} /> —{" "}
        {REVIEW_STATUS[line.review.status]}
        {line.review.rejectReason ? ` (${line.review.rejectReason})` : ""}
      </p>
    );
  }
  if (!line.canReview) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (rating === 0) {
      setError("Choisissez une note de 1 à 5 étoiles.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/order-lines/${line.id}/review`, {
        method: "POST",
        body: { rating, ...(body.trim() ? { body: body.trim() } : {}) },
      });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className={styles.rowActions}>
        <span>{line.productName}</span>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Donner mon avis
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={order.form}>
      <p>
        <strong>{line.productName}</strong>
      </p>
      <StarsInput value={rating} onChange={setRating} name={`note-${line.id}`} />
      <Field label="Votre avis (facultatif)">
        <textarea
          className={fieldStyles.control}
          rows={3}
          maxLength={1000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Finition, conformité à la fiche, emballage…"
        />
      </Field>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.rowActions}>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Envoi…" : "Publier mon avis"}
        </Button>
      </div>
    </form>
  );
}
