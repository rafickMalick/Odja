"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button, ButtonLink } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import { ORDER_TONE } from "./status";

/**
 * Mes commandes.
 *
 * Ce qui attend une validation passe en tête, dans un panneau distinct : c'est
 * le seul geste que le client doit faire, et il déclenche le versement au
 * créateur. Le reste est de la consultation.
 */

interface Order {
  reference: string;
  status: string;
  statusLabel: string;
  subOrders: { reference: string; shopName: string; status: string; statusLabel: string }[];
  totalXof: number;
  placedAt: string | null;
  createdAt: string;
}

interface OrdersPage {
  items: Order[];
  nextCursor: string | null;
}

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void apiFetch<OrdersPage>("/orders")
      .then((page) => {
        setOrders(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<OrdersPage>(`/orders?cursor=${encodeURIComponent(cursor)}`);
      setOrders((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      /* on laisse la liste en l'état : réessayer suffit */
    } finally {
      setLoadingMore(false);
    }
  }

  const awaiting = orders.flatMap((order) =>
    order.subOrders
      .filter((sub) => sub.status === "DELIVERED")
      .map((sub) => ({ order, sub })),
  );

  return (
    <>
      <PageHead
        title="Mes commandes"
        subtitle="Chaque atelier est livré séparément — vous validez chaque colis à sa réception."
      />

      {awaiting.length > 0 ? (
        <Panel title={`${awaiting.length} colis à confirmer`}>
          <p className={styles.muted}>
            Vérifiez la pièce, puis validez : le créateur est réglé 24 h après. Sans réponse de
            votre part, la validation est automatique au bout de 72 h.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Atelier</th>
                  <th>Commande</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {awaiting.map(({ order, sub }) => (
                  <tr key={sub.reference}>
                    <td>{sub.shopName}</td>
                    <td>{order.reference}</td>
                    <td className={styles.rowActions}>
                      <ButtonLink href={`/compte/commandes/${order.reference}`}>
                        Vérifier
                      </ButtonLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : orders.length === 0 ? (
          <EmptyState
            title="Aucune commande"
            text="Vos commandes apparaîtront ici, avec le suivi de chaque livraison."
            action={<ButtonLink href="/catalogue">Découvrir le catalogue</ButtonLink>}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Ateliers</th>
                  <th>État</th>
                  <th className={styles.numeric}>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.reference}>
                    <td>
                      <Link href={`/compte/commandes/${order.reference}`}>
                        {order.reference}
                      </Link>
                    </td>
                    <td>
                      {order.subOrders.map((sub) => sub.shopName).join(", ")}
                    </td>
                    <td>
                      <Badge type={ORDER_TONE[order.status] ?? "pending"}>
                        {order.statusLabel}
                      </Badge>
                    </td>
                    <td className={styles.numeric}>{formatFcfa(order.totalXof)}</td>
                    <td>{formatDate(order.placedAt ?? order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor ? (
              <div style={{ marginTop: "0.75rem" }}>
                <Button
                  variant="secondary"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Chargement…" : "Charger la suite"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
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
