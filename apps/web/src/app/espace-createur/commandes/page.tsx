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
import { formatFcfa } from "@/lib/format";

import orders from "./orders.module.css";

/**
 * Commandes reçues par l'atelier.
 *
 * Chaque créateur d'une commande multi-ateliers a sa propre sous-commande et
 * sa propre livraison : il ne voit ici que ce qui le concerne, jamais les
 * pièces d'un confrère ni ce que le client a payé au total.
 */

interface SubOrder {
  reference: string;
  orderReference: string;
  status: string;
  statusLabel: string;
  lines: { productName: string; quantity: number; makerPriceXof: number }[];
  itemsMakerSubtotalXof: number;
  respondByAt: string | null;
  dueReadyAt: string | null;
  createdAt: string;
}

const TONE: Record<string, "pending" | "success" | "info" | "warning" | "danger"> = {
  RECEIVED: "warning",
  PAYMENT_CONFIRMED: "warning",
  IN_PRODUCTION: "info",
  READY_FOR_PICKUP: "info",
  IN_DELIVERY: "info",
  DELIVERED: "pending",
  VALIDATED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
};

export default function MakerOrdersPage() {
  const [scope, setScope] = useState<"current" | "past">("current");
  const [items, setItems] = useState<SubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiFetch<SubOrder[]>(`/maker/orders?scope=${scope}`));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (reference: string, action: string, body?: unknown) => {
    setBusy(reference);
    setError(null);
    try {
      await apiFetch(`/maker/orders/${reference}/${action}`, {
        method: "POST",
        ...(body !== undefined ? { body } : {}),
      });
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof ApiError ? actionError.message : "Action impossible.",
      );
    } finally {
      setBusy(null);
    }
  };

  const reject = async (reference: string) => {
    /* Le motif est obligatoire côté API : il part au client dans l'avis
       d'annulation, et sert d'historique si l'atelier refuse souvent. */
    const reason = window.prompt(
      "Pourquoi refusez-vous cette commande ? Le client verra ce motif.",
    );
    if (!reason?.trim()) return;
    await act(reference, "reject", { reason: reason.trim() });
  };

  return (
    <>
      <PageHead
        title="Commandes"
        subtitle="Acceptez, préparez, signalez prêt. Le livreur est mandaté par Ojà dès que la pièce est prête."
      />

      <div className={orders.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scope === "current"}
          className={scope === "current" ? orders.tabActive : orders.tab}
          onClick={() => setScope("current")}
        >
          En cours
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "past"}
          className={scope === "past" ? orders.tabActive : orders.tab}
          onClick={() => setScope("past")}
        >
          Historique
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title={scope === "current" ? "Aucune commande en cours" : "Aucun historique"}
            text={
              scope === "current"
                ? "Les commandes payées apparaissent ici. Vous avez 48 h pour répondre à chacune."
                : "Les commandes livrées, validées ou annulées se retrouvent ici."
            }
          />
        </Panel>
      ) : (
        items.map((subOrder) => (
          <Panel
            key={subOrder.reference}
            title={subOrder.reference}
            action={<Badge type={TONE[subOrder.status] ?? "pending"}>{subOrder.statusLabel}</Badge>}
          >
            <ul className={orders.lines}>
              {subOrder.lines.map((line, index) => (
                <li key={`${subOrder.reference}-${index}`}>
                  <span>
                    {line.productName} × {line.quantity}
                  </span>
                  <strong>{formatFcfa(line.makerPriceXof * line.quantity)}</strong>
                </li>
              ))}
              <li className={orders.total}>
                <span>Votre part</span>
                <strong>{formatFcfa(subOrder.itemsMakerSubtotalXof)}</strong>
              </li>
            </ul>

            {/* Le délai de réponse ne vaut que tant que la commande attend
                l'atelier : une fois acceptée, l'annoncer encore ferait croire
                qu'elle peut être annulée. */}
            {subOrder.respondByAt &&
            ["RECEIVED", "PAYMENT_CONFIRMED"].includes(subOrder.status) ? (
              <p className={styles.muted}>
                À répondre {relative(subOrder.respondByAt)}. Sans réponse, la commande est
                annulée et le client remboursé.
              </p>
            ) : null}

            {subOrder.dueReadyAt && subOrder.status === "IN_PRODUCTION" ? (
              <p className={styles.muted}>
                À tenir prête {relative(subOrder.dueReadyAt)}.
              </p>
            ) : null}

            <div className={styles.rowActions}>
              {["RECEIVED", "PAYMENT_CONFIRMED"].includes(subOrder.status) ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reject(subOrder.reference)}
                    disabled={busy === subOrder.reference}
                  >
                    Refuser
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void act(subOrder.reference, "accept")}
                    disabled={busy === subOrder.reference}
                  >
                    Accepter
                  </Button>
                </>
              ) : null}

              {subOrder.status === "IN_PRODUCTION" ? (
                <Button
                  type="button"
                  onClick={() => void act(subOrder.reference, "ready")}
                  disabled={busy === subOrder.reference}
                >
                  Prête pour l’enlèvement
                </Button>
              ) : null}
            </div>
          </Panel>
        ))
      )}
    </>
  );
}

/** « dans 34 h », « depuis 2 j »  plus parlant qu'une date à l'heure près. */
function relative(iso: string): string {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return `immédiatement (délai dépassé depuis ${Math.abs(hours)} h)`;
  if (hours < 48) return `dans ${hours} h`;
  return `dans ${Math.round(hours / 24)} jours`;
}
