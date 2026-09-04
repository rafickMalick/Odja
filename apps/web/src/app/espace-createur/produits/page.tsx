"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

interface MakerProduct {
  id: string;
  slug: string;
  name: string;
  status: string;
  makerPriceXof: number;
  quantityAvailable: number;
  quantityReserved: number;
  imageCount: number;
  rejectReason: string | null;
  updatedAt: string;
}

/**
 * Liste des pièces.
 *
 * La colonne « Photos » affiche le compte sur cinq plutôt qu'un simple nombre :
 * la règle des 3 à 5 photos décide de la mise en vente, autant qu'elle soit
 * lisible d'un coup d'œil.
 */
export default function MakerProductsPage() {
  const [products, setProducts] = useState<MakerProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<MakerProduct[]>("/maker/products")
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHead
        title="Mes pièces"
        subtitle="Vos fiches, leur état, et ce qu'il leur manque pour partir en vente."
        action={<ButtonLink href="/espace-createur/produits/nouveau">Ajouter une pièce</ButtonLink>}
      />

      <Panel>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : products.length === 0 ? (
          <EmptyState
            title="Aucune pièce"
            text="Une fiche demande trois photos au minimum, un prix, et les dimensions — celles-ci servent à calculer la livraison."
            action={
              <ButtonLink href="/espace-createur/produits/nouveau">
                Ajouter ma première pièce
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
                  <th className={styles.numeric}>Stock</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link href={`/espace-createur/produits/${product.id}`}>
                        {product.name}
                      </Link>
                      {product.rejectReason ? (
                        <p className={styles.muted}>{product.rejectReason}</p>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={product.status} />
                    </td>
                    <td className={styles.numeric}>{formatFcfa(product.makerPriceXof)}</td>
                    <td className={styles.numeric}>
                      {product.quantityAvailable - product.quantityReserved}
                      {product.quantityReserved > 0 ? (
                        <span className={styles.muted}> ({product.quantityReserved} réservé)</span>
                      ) : null}
                    </td>
                    <td>
                      <span className={product.imageCount < 3 ? styles.error : undefined}>
                        {product.imageCount} / 5
                      </span>
                    </td>
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

function StatusBadge({ status }: { status: string }) {
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
