"use client";

import { useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import { ORDER_TONE, SUB_ORDER_TONE } from "../../../compte/status";

/**
 * Recherche de commande.
 *
 * Elle accepte le nom ou le téléphone autant que la référence : au téléphone,
 * un client donne rarement « CMD-2026-000412 », mais toujours son nom.
 */

interface Order {
  reference: string;
  status: string;
  shipFullName: string;
  shipPhone: string;
  totalXof: number;
  subOrders: { reference: string; shopName: string; status: string }[];
  placedAt: string | null;
  createdAt: string;
}

export default function AdminOrderSearchPage() {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setOrders(
      await apiFetch<Order[]>(
        `/admin/orders/search?q=${encodeURIComponent(query.trim())}`,
      ).catch(() => []),
    );
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title="Rechercher une commande"
        subtitle="Par référence, par nom du destinataire, ou par téléphone."
      />

      <Panel>
        <form onSubmit={search}>
          <Field
            label="Référence, nom ou téléphone"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="CMD-2026-000412, Awa Koné, +229 01…"
          />
          <div className={styles.rowActions}>
            <Button type="submit" disabled={busy}>
              {busy ? "Recherche…" : "Rechercher"}
            </Button>
          </div>
        </form>
      </Panel>

      {orders !== null ? (
        <Panel title={`${orders.length} résultat${orders.length > 1 ? "s" : ""}`}>
          {orders.length === 0 ? (
            <EmptyState
              title="Aucune commande"
              text="Vérifiez l’orthographe, ou cherchez sur le numéro de téléphone."
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Destinataire</th>
                    <th>État</th>
                    <th>Ateliers</th>
                    <th className={styles.numeric}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.reference}>
                      <td>
                        {order.reference}
                        <p className={styles.muted}>
                          {formatDate(order.placedAt ?? order.createdAt)}
                        </p>
                      </td>
                      <td>
                        {order.shipFullName}
                        <p className={styles.muted}>{order.shipPhone}</p>
                      </td>
                      <td>
                        <Badge type={ORDER_TONE[order.status] ?? "pending"}>
                          {order.status}
                        </Badge>
                      </td>
                      <td>
                        {order.subOrders.map((subOrder) => (
                          <p key={subOrder.reference}>
                            {subOrder.shopName}{" "}
                            <Badge type={SUB_ORDER_TONE[subOrder.status] ?? "pending"}>
                              {subOrder.status}
                            </Badge>
                          </p>
                        ))}
                      </td>
                      <td className={styles.numeric}>{formatFcfa(order.totalXof)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
