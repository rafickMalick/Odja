"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
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
 * Modération des fiches.
 *
 * Tout ce qui sert à décider est sur la carte : les photos, la description, les
 * dimensions, le prix vitrine. Un agent qui doit ouvrir un autre onglet pour
 * voir la pièce finit par valider sans regarder.
 */

interface PendingProduct {
  id: string;
  name: string;
  description: string;
  material: string | null;
  categoryName: string;
  makerShopName: string;
  makerCity: string;
  makerPriceXof: number;
  commissionBps: number;
  isMadeToOrder: boolean;
  leadTimeDays: number | null;
  quantityAvailable: number;
  dimensions: { lengthMm: number; widthMm: number; heightMm: number; weightGrams: number };
  images: { url: string; alt: string | null }[];
  submittedAt: string | null;
}

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<PendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await apiFetch<PendingProduct[]>("/admin/catalog/products/pending"));
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, decision: "PUBLISH" | "REJECT") => {
    let reason: string | undefined;
    if (decision === "REJECT") {
      const answer = window.prompt("Motif du refus (transmis au créateur) :");
      if (!answer?.trim()) return;
      reason = answer.trim();
    }

    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/admin/catalog/products/${id}/review`, {
        method: "POST",
        body: { decision, ...(reason ? { reason } : {}) },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Décision impossible.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title="Fiches à valider"
        subtitle="Une fiche refusée doit l’être avec un motif : c’est ce que le créateur lira pour corriger."
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : products.length === 0 ? (
        <Panel>
          <EmptyState title="File vide" text="Aucune fiche n’attend de validation." />
        </Panel>
      ) : (
        products.map((product) => {
          const commission = Math.round((product.makerPriceXof * product.commissionBps) / 10_000);
          return (
            <Panel
              key={product.id}
              title={product.name}
              action={
                <span className={styles.muted}>
                  {product.makerShopName} · {product.makerCity}
                </span>
              }
            >
              {product.images.length > 0 ? (
                <div className={admin.thumbs}>
                  {product.images.map((image, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${product.id}-${index}`}
                      src={image.url}
                      alt={image.alt ?? product.name}
                    />
                  ))}
                </div>
              ) : (
                <p className={styles.error}>Aucune photo — la fiche ne devrait pas être ici.</p>
              )}

              <p className={admin.description}>{product.description}</p>

              <dl className={admin.details}>
                <div>
                  <dt>Catégorie</dt>
                  <dd>{product.categoryName}</dd>
                </div>
                <div>
                  <dt>Matériau</dt>
                  <dd>{product.material ?? "—"}</dd>
                </div>
                <div>
                  <dt>Prix créateur</dt>
                  <dd>{formatFcfa(product.makerPriceXof)}</dd>
                </div>
                <div>
                  <dt>Prix vitrine</dt>
                  <dd>
                    {formatFcfa(product.makerPriceXof + commission)}
                    <span className={styles.muted}>
                      {" "}
                      (commission {formatFcfa(commission)})
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Disponibilité</dt>
                  <dd>
                    {product.isMadeToOrder
                      ? `Sur commande, ${product.leadTimeDays ?? "?"} j`
                      : `${product.quantityAvailable} en stock`}
                  </dd>
                </div>
                <div>
                  <dt>Encombrement</dt>
                  <dd>
                    {product.dimensions.lengthMm} × {product.dimensions.widthMm} ×{" "}
                    {product.dimensions.heightMm} mm ·{" "}
                    {(product.dimensions.weightGrams / 1000).toFixed(1)} kg
                  </dd>
                </div>
                <div>
                  <dt>Déposée le</dt>
                  <dd>
                    {product.submittedAt
                      ? new Date(product.submittedAt).toLocaleDateString("fr-FR")
                      : "—"}
                  </dd>
                </div>
              </dl>

              <div className={styles.rowActions}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void review(product.id, "REJECT")}
                  disabled={busy === product.id}
                >
                  Refuser
                </Button>
                <Button
                  type="button"
                  onClick={() => void review(product.id, "PUBLISH")}
                  disabled={busy === product.id}
                >
                  Publier
                </Button>
              </div>
            </Panel>
          );
        })
      )}
    </>
  );
}
