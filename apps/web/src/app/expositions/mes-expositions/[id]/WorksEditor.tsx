"use client";

import type { OrganizerExhibition } from "@oja/contracts";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { UploadError, uploadFile } from "@/lib/upload";

import editor from "../editor.module.css";

/**
 * Les œuvres d'une exposition (§ 6.3).
 *
 * Chacune est examinée individuellement par l'administration (§ 6.5). Un
 * créateur dont la boutique est validée peut lier une œuvre à une fiche de
 * son catalogue : c'est elle qui la rend achetable pendant l'exposition.
 */

interface MakerProduct {
  id: string;
  name: string;
  status: string;
}

const EMPTY = { title: "", artistName: "", description: "", materials: "", dimensions: "", productId: "" };

const REVIEW: Record<string, { tone: "pending" | "success" | "danger"; label: string }> = {
  PENDING: { tone: "pending", label: "À examiner" },
  APPROVED: { tone: "success", label: "Validée" },
  REJECTED: { tone: "danger", label: "Refusée" },
};

export function WorksEditor({
  exhibition,
  editable,
  onChange,
}: {
  exhibition: OrganizerExhibition;
  editable: boolean;
  onChange: (exhibition: OrganizerExhibition) => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [proofKey, setProofKey] = useState<string | null>(null);
  const [products, setProducts] = useState<MakerProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!exhibition.canSellWorks) return;
    void apiFetch<MakerProduct[]>("/maker/products")
      .then((list) => setProducts(list.filter((product) => product.status !== "ARCHIVED")))
      .catch(() => setProducts([]));
  }, [exhibition.canSellWorks]);

  const set = (key: keyof typeof EMPTY, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const upload = async (file: File, kind: "image" | "proof") => {
    setBusy(true);
    setMessage(null);
    try {
      const { fileKey } = await uploadFile(file, kind === "image" ? "exhibition-image" : "exhibition-document");
      if (kind === "image") setImageKeys((keys) => [...keys, fileKey].slice(0, 6));
      else setProofKey(fileKey);
    } catch (cause) {
      setMessage(cause instanceof UploadError ? cause.message : "L’envoi a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    const payload: Record<string, unknown> = {
      title: values.title,
      artistName: values.artistName,
      description: values.description,
      imageKeys,
    };
    if (values.materials.trim()) payload["materials"] = values.materials.trim();
    if (values.dimensions.trim()) payload["dimensions"] = values.dimensions.trim();
    if (values.productId) payload["productId"] = values.productId;
    if (proofKey) payload["proofKey"] = proofKey;

    try {
      onChange(
        await apiFetch<OrganizerExhibition>(`/my/exhibitions/${exhibition.id}/works`, {
          method: "POST",
          body: payload,
        }),
      );
      setValues(EMPTY);
      setImageKeys([]);
      setProofKey(null);
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of cause.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(cause.problem.errors?.length ? "Quelques champs demandent une correction." : cause.message);
      } else {
        setMessage("Ajout impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (workId: string) => {
    setBusy(true);
    try {
      onChange(
        await apiFetch<OrganizerExhibition>(`/my/exhibitions/${exhibition.id}/works/${workId}`, {
          method: "DELETE",
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`Œuvres (${exhibition.works.length}${exhibition.plan?.maxWorks ? ` / ${exhibition.plan.maxWorks}` : ""})`}>
      {exhibition.works.length > 0 ? (
        <ul className={editor.works}>
          {exhibition.works.map((work) => (
            <li key={work.id} className={editor.work}>
              {work.imageUrls[0] ? <img src={work.imageUrls[0]} alt="" /> : <img alt="" />}
              <div className={editor.workBody}>
                <strong>{work.title}</strong>
                <span className={styles.muted}>
                  {work.artistName}
                  {work.productName ? ` · en vente : ${work.productName}` : " · présentée seulement"}
                </span>
                <span>
                  <Badge type={REVIEW[work.reviewStatus]!.tone}>{REVIEW[work.reviewStatus]!.label}</Badge>
                </span>
                {work.reviewNote ? <span className={styles.error}>{work.reviewNote}</span> : null}
              </div>
              {editable ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void remove(work.id)}>
                  Retirer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Aucune œuvre pour l’instant.</p>
      )}

      {editable ? (
        <form onSubmit={add} className={editor.form} noValidate>
          <FieldRow>
            <Field label="Titre de l’œuvre" value={values.title} onChange={(e) => set("title", e.target.value)} error={errors["title"]} />
            <Field label="Artiste ou créateur" value={values.artistName} onChange={(e) => set("artistName", e.target.value)} error={errors["artistName"]} />
          </FieldRow>
          <Field label="Description" error={errors["description"]}>
            <textarea className={fieldStyles.control} rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <FieldRow>
            <Field label="Matériaux (facultatif)" value={values.materials} onChange={(e) => set("materials", e.target.value)} />
            <Field label="Dimensions (facultatif)" value={values.dimensions} onChange={(e) => set("dimensions", e.target.value)} placeholder="60 × 40 cm" />
          </FieldRow>
          {exhibition.canSellWorks ? (
            <Field label="Mettre en vente avec une fiche de ma boutique (facultatif)" error={errors["productId"]}>
              <select className={fieldStyles.control} value={values.productId} onChange={(e) => set("productId", e.target.value)}>
                <option value="">Présentée seulement, pas en vente</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                    {product.status !== "PUBLISHED" ? " (pas encore en ligne)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className={styles.muted}>
              Pour vendre les œuvres exposées, ouvrez une boutique créateur : la vente passe par elle.
            </p>
          )}
          <div className={editor.actions}>
            <label className={editor.upload}>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, "image"); e.target.value = ""; }} />
              Photo ({imageKeys.length}/6)
            </label>
            <label className={editor.upload}>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, "proof"); e.target.value = ""; }} />
              {proofKey ? "Justificatif joint ✓" : "Justificatif de propriété (facultatif)"}
            </label>
          </div>
          <div className={editor.actions}>
            <Button type="submit" disabled={busy}>
              Ajouter l’œuvre
            </Button>
          </div>
          {message ? <p className={styles.error}>{message}</p> : null}
        </form>
      ) : null}
    </Panel>
  );
}
