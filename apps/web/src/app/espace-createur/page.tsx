"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ButtonLink } from "@/components/Button";
import { Badge } from "@/components/Badge";
import {
  EmptyState,
  PageHead,
  Panel,
  StatTile,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

/**
 * Tableau de bord du créateur.
 *
 * Le cahier client demande six chiffres : nombre de pièces, commandes en
 * cours, pièces vendues, revenus, solde disponible, notifications. On les
 * donne, mais chacun mène quelque part  un chiffre sur lequel on ne peut pas
 * cliquer n'est qu'une décoration.
 */

interface MakerProduct {
  id: string;
  name: string;
  status: string;
  makerPriceXof: number;
  imageCount: number;
  rejectReason: string | null;
}

interface MakerSubOrder {
  reference: string;
  orderReference: string;
  status: string;
  statusLabel: string;
  itemsMakerSubtotalXof: number;
  respondByAt: string | null;
  lines: { productName: string; quantity: number }[];
}

interface Wallet {
  owedXof: number;
  scheduledXof: number;
  readyXof: number;
  paidXof: number;
}

export default function MakerDashboard() {
  const [products, setProducts] = useState<MakerProduct[]>([]);
  const [current, setCurrent] = useState<MakerSubOrder[]>([]);
  const [past, setPast] = useState<MakerSubOrder[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [p, c, h, w] = await Promise.all([
        apiFetch<MakerProduct[]>("/maker/products").catch(() => []),
        apiFetch<MakerSubOrder[]>("/maker/orders").catch(() => []),
        apiFetch<MakerSubOrder[]>("/maker/orders?scope=past").catch(() => []),
        apiFetch<Wallet>("/maker/wallet").catch(() => null),
      ]);
      if (cancelled) return;
      setProducts(p);
      setCurrent(c);
      setPast(h);
      setWallet(w);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className={styles.muted}>Chargement…</p>;

  const published = products.filter((product) => product.status === "PUBLISHED");
  const sold = past.filter((subOrder) => subOrder.status === "VALIDATED");
  const revenue = sold.reduce((total, subOrder) => total + subOrder.itemsMakerSubtotalXof, 0);

  /* Ce qui attend une action de l'atelier  pas ce qui existe. C'est le seul
     chiffre sur lequel il doit se précipiter. */
  const waiting = current.filter((subOrder) =>
    ["RECEIVED", "PAYMENT_CONFIRMED"].includes(subOrder.status),
  );

  return (
    <>
      <PageHead
        title="Tableau de bord"
        subtitle="Ce qui attend une action de votre part, et où en sont vos ventes."
        action={<ButtonLink href="/espace-createur/produits/nouveau">Ajouter une pièce</ButtonLink>}
      />

      {waiting.length > 0 ? (
        <Panel
          title={`${waiting.length} commande${waiting.length > 1 ? "s" : ""} à accepter`}
          action={<Link href="/espace-createur/commandes">Tout voir</Link>}
        >
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Pièces</th>
                  <th className={styles.numeric}>Votre part</th>
                  <th>À répondre avant</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((subOrder) => (
                  <tr key={subOrder.reference}>
                    <td>{subOrder.reference}</td>
                    <td>
                      {subOrder.lines
                        .map((line) => `${line.productName} × ${line.quantity}`)
                        .join(", ")}
                    </td>
                    <td className={styles.numeric}>
                      {formatFcfa(subOrder.itemsMakerSubtotalXof)}
                    </td>
                    <td>
                      {subOrder.respondByAt
                        ? deadline(subOrder.respondByAt)
                        : "Pas de délai"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <div className={styles.statGrid}>
        <StatTile
          label="Pièces en ligne"
          value={String(published.length)}
          hint={`${products.length} au total`}
        />
        <StatTile label="Commandes en cours" value={String(current.length)} />
        <StatTile label="Pièces vendues" value={String(sold.length)} />
        <StatTile
          label="Revenus encaissés"
          value={formatFcfa(revenue)}
          hint="votre prix, en entier"
        />
        <StatTile
          label="Solde à venir"
          value={formatFcfa(wallet?.scheduledXof ?? 0)}
          hint="versé 24 h après validation du client"
        />
        <StatTile
          label="Prêt à verser"
          value={formatFcfa(wallet?.readyXof ?? 0)}
        />
      </div>

      <Panel
        title="Vos pièces"
        action={<Link href="/espace-createur/produits">Tout voir</Link>}
      >
        {products.length === 0 ? (
          <EmptyState
            title="Aucune pièce pour l’instant"
            text="Ajoutez votre première pièce : trois photos, un prix, des dimensions, et elle part en validation."
            action={
              <ButtonLink href="/espace-createur/produits/nouveau">
                Ajouter une pièce
              </ButtonLink>
            }
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Pièce</th>
                  <th>État</th>
                  <th className={styles.numeric}>Votre prix</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 5).map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link href={`/espace-createur/produits/${product.id}`}>
                        {product.name}
                      </Link>
                    </td>
                    <td>
                      <ProductBadge status={product.status} />
                    </td>
                    <td className={styles.numeric}>
                      {formatFcfa(product.makerPriceXof)}
                    </td>
                    <td>{product.imageCount} / 5</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function ProductBadge({ status }: { status: string }) {
  const map: Record<string, { type: "pending" | "success" | "info" | "warning" | "danger"; label: string }> = {
    DRAFT: { type: "pending", label: "Brouillon" },
    PENDING_REVIEW: { type: "info", label: "En validation" },
    PUBLISHED: { type: "success", label: "En ligne" },
    REJECTED: { type: "danger", label: "Refusée" },
    ARCHIVED: { type: "warning", label: "Archivée" },
  };
  const entry = map[status] ?? { type: "pending" as const, label: status };
  return <Badge type={entry.type}>{entry.label}</Badge>;
}

/** Échéance exprimée en délai restant : « dans 34 h » se lit mieux qu'une date. */
function deadline(iso: string): string {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return "Délai dépassé";
  if (hours < 24) return `dans ${hours} h`;
  return `dans ${Math.round(hours / 24)} j`;
}
