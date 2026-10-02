"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { MyTickets } from "@/components/support/MyTickets";
import { NewTicketForm } from "@/components/support/NewTicketForm";
import support from "@/components/support/support.module.css";
import { apiFetch } from "@/lib/api";

import { ORDER_TONE } from "../status";

/**
 * Service client, côté acheteur.
 *
 * Trois choses sur un même écran : écrire au service client, retrouver ses
 * demandes, et voir où en sont ses commandes, puisque c'est souvent d'elles
 * qu'on vient parler.
 */

interface Me {
  firstName: string;
  lastName: string;
  email: string;
}

interface Order {
  reference: string;
  status: string;
  statusLabel: string;
  createdAt: string;
}

export default function AccountSupportPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void apiFetch<Me>("/auth/me")
      .then(setMe)
      .catch(() => setMe(null));
    void apiFetch<{ items: Order[] }>("/orders?limit=20")
      .then((page) => setOrders(page.items))
      .catch(() => setOrders([]));
  }, []);

  return (
    <>
      <PageHead
        title="Service client"
        subtitle="Une question, un souci avec une commande ? Écrivez-nous, nous répondons ici."
      />

      <div className={support.layout}>
        <div>
          <Panel title="Contacter le service client">
            <NewTicketForm
              identity={me ? { name: `${me.firstName} ${me.lastName}`, email: me.email } : null}
              orders={orders.map((order) => ({
                reference: order.reference,
                label: `${order.reference} · ${order.statusLabel}`,
              }))}
              onCreated={(ticket) => {
                setRefreshKey((key) => key + 1);
                router.push(`/compte/support/${ticket.reference}`);
              }}
            />
            <p className={styles.muted}>
              Pièce reçue cassée ou non conforme ? Signalez-le depuis la commande concernée :
              c’est une <Link href="/compte/reclamations">réclamation</Link>, qui peut donner
              lieu à un remboursement.
            </p>
          </Panel>

          <Panel title="Mes demandes">
            <MyTickets basePath="/compte/support" refreshKey={refreshKey} />
          </Panel>
        </div>

        <Panel title="Suivi de mes commandes">
          {orders.length === 0 ? (
            <p className={styles.muted}>Aucune commande pour l’instant.</p>
          ) : (
            <ul className={support.messages}>
              {orders.slice(0, 8).map((order) => (
                <li key={order.reference} className={support.meta}>
                  <Link href={`/compte/commandes/${order.reference}`}>{order.reference}</Link>
                  <Badge type={ORDER_TONE[order.status] ?? "pending"}>{order.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.muted}>
            <Link href="/compte">Toutes mes commandes et leur historique</Link>
          </p>
        </Panel>
      </div>
    </>
  );
}
