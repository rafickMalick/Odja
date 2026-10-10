"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import { PhotoGallery } from "../PhotoGallery";
import { ProductForm, type ProductFormValues, type SaleState } from "../ProductForm";
import form from "../form.module.css";

interface ProductDetail {
  id: string;
  name: string;
  status: string;
  categoryId: string;
  description: string;
  material: string | null;
  isForSale: boolean;
  availability: SaleState;
  makerPriceXof: number;
  commissionBps: number;
  isMadeToOrder: boolean;
  quantityAvailable: number;
  leadTimeDays: number | null;
  observations: string | null;
  packagingNotes: string | null;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  rejectReason: string | null;
  images: { id: string; url: string; alt: string | null; position: number }[];
  blockers: string[];
}

const LABELS: Record<string, { type: "pending" | "success" | "info" | "warning" | "danger"; label: string }> = {
  DRAFT: { type: "pending", label: "Brouillon" },
  PENDING_REVIEW: { type: "info", label: "En validation" },
  PUBLISHED: { type: "success", label: "En ligne" },
  REJECTED: { type: "danger", label: "Refusée" },
  ARCHIVED: { type: "warning", label: "Archivée" },
};

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setProduct(await apiFetch<ProductDetail>(`/maker/products/${id}`));
    } catch {
      setError("Cette fiche est introuvable.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!product) return <p className={styles.muted}>Chargement…</p>;

  const state = LABELS[product.status] ?? { type: "pending" as const, label: product.status };
  const canSubmit = ["DRAFT", "REJECTED"].includes(product.status) && product.blockers.length === 0;

  const submitForReview = async () => {
    setBusy(true);
    try {
      await apiFetch(`/maker/products/${id}/submit`, { method: "POST" });
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : "Envoi impossible pour le moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    await apiFetch(`/maker/products/${id}/archive`, { method: "POST" }).catch(() => undefined);
    await load();
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title={product.name}
        subtitle="Modifier une fiche déjà en ligne la renvoie en validation."
        action={<Badge type={state.type}>{state.label}</Badge>}
      />

      {product.status === "REJECTED" && product.rejectReason ? (
        <p className={styles.error}>Refusée : {product.rejectReason}</p>
      ) : null}

      <PhotoGallery
        productId={product.id}
        images={product.images}
        onChange={(images) => setProduct({ ...product, images })}
      />

      {/* Tous les manques à la fois, plutôt qu'un par tentative d'envoi. */}
      {product.blockers.length > 0 ? (
        <Panel title="Avant la mise en vente">
          <ul className={styles.muted}>
            {product.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {["DRAFT", "REJECTED", "PUBLISHED", "PENDING_REVIEW"].includes(product.status) ? (
        <div className={form.actions}>
          {canSubmit ? (
            <Button type="button" onClick={submitForReview} disabled={busy}>
              {busy ? "Envoi…" : "Envoyer en validation"}
            </Button>
          ) : null}
          {product.status !== "ARCHIVED" ? (
            <Button type="button" variant="outline" onClick={archive} disabled={busy}>
              Retirer de la vente
            </Button>
          ) : null}
        </div>
      ) : null}

      {saved ? <p className={styles.muted}>Modifications enregistrées.</p> : null}

      <ProductForm
        initial={toFormValues(product)}
        commissionBps={product.commissionBps}
        submitLabel="Enregistrer les modifications"
        onSubmit={async (payload) => {
          await apiFetch(`/maker/products/${id}`, { method: "PATCH", body: payload });
          setSaved(true);
          await load();
          router.refresh();
        }}
      />
    </>
  );
}

function toFormValues(product: ProductDetail): ProductFormValues {
  return {
    name: product.name,
    categoryId: product.categoryId,
    description: product.description,
    material: product.material ?? "",
    isForSale: product.isForSale,
    availability: product.availability,
    makerPriceXof: positive(product.makerPriceXof),
    isMadeToOrder: product.isMadeToOrder,
    quantityAvailable: String(product.quantityAvailable),
    leadTimeDays: product.leadTimeDays ? String(product.leadTimeDays) : "",
    observations: product.observations ?? "",
    packagingNotes: product.packagingNotes ?? "",
    weightGrams: positive(product.weightGrams),
    lengthMm: positive(product.lengthMm),
    widthMm: positive(product.widthMm),
    heightMm: positive(product.heightMm),
  };
}

/* Une réalisation de portfolio porte 0 en prix et en mesures : un champ vide
   invite à saisir, un « 0 » ressemble à une valeur. */
function positive(value: number): string {
  return value > 0 ? String(value) : "";
}
