"use client";

import type { OrganizerExhibition } from "@oja/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { STATUS_LABELS, STATUS_TONE } from "@/lib/exhibitions";
import { UploadError, uploadFile } from "@/lib/upload";

import editor from "../editor.module.css";
import { ExhibitionForm } from "../ExhibitionForm";
import { WorksEditor } from "./WorksEditor";

/**
 * Un dossier d'exposition, de la rédaction à la mise en ligne.
 *
 * Tant qu'il est en brouillon ou renvoyé pour modifications, l'organisateur
 * l'édite librement. Une fois soumis, la page devient un suivi : décision,
 * contrat, paiement, date de mise en ligne (§ 6.4).
 */
export default function ExhibitionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useToast();
  const [exhibition, setExhibition] = useState<OrganizerExhibition | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExhibition(await apiFetch<OrganizerExhibition>(`/my/exhibitions/${id}`));
    } catch {
      setFailed(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className={styles.error}>Ce dossier est introuvable.</p>;
  if (!exhibition) return <p className={styles.muted}>Chargement…</p>;

  const editable = exhibition.status === "DRAFT" || exhibition.status === "CHANGES_REQUESTED";

  const attach = async (slot: "cover" | "dossier" | "venue", file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const { fileKey } = await uploadFile(file, slot === "dossier" ? "exhibition-document" : "exhibition-image");
      setExhibition(
        await apiFetch<OrganizerExhibition>(`/my/exhibitions/${id}/files`, {
          method: "POST",
          body: { slot, fileKey },
        }),
      );
    } catch (cause) {
      setMessage(cause instanceof UploadError || cause instanceof ApiError ? cause.message : "L’envoi a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setExhibition(await apiFetch<OrganizerExhibition>(`/my/exhibitions/${id}/submit`, { method: "POST" }));
      notify("Dossier soumis : l’équipe Ojà l’examine.", { tone: "success" });
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Soumission impossible.");
    } finally {
      setBusy(false);
    }
  };

  const steps: { label: string; done: boolean }[] = [
    { label: "Dossier soumis", done: exhibition.status !== "DRAFT" },
    {
      label: "Projet accepté",
      done: ["ACCEPTED", "SCHEDULED", "PUBLISHED", "SUSPENDED"].includes(exhibition.status),
    },
    { label: "Contrat envoyé", done: Boolean(exhibition.contractSentAt) },
    { label: "Contrat signé", done: Boolean(exhibition.contractSignedAt) },
    { label: "Formule réglée", done: Boolean(exhibition.paymentReceivedAt) || (exhibition.plan?.priceXof ?? 0) === 0 },
    {
      label: exhibition.publishAt
        ? `Mise en ligne le ${new Date(exhibition.publishAt).toLocaleDateString("fr-FR")}`
        : "Mise en ligne programmée",
      done: ["SCHEDULED", "PUBLISHED"].includes(exhibition.status),
    },
  ];

  return (
    <>
      <PageHead
        title={exhibition.title}
        subtitle={exhibition.plan ? `Formule ${exhibition.plan.name}` : "Aucune formule choisie"}
        action={<Badge type={STATUS_TONE[exhibition.status]}>{STATUS_LABELS[exhibition.status]}</Badge>}
      />

      {exhibition.reviewNote && ["CHANGES_REQUESTED", "REJECTED"].includes(exhibition.status) ? (
        <p className={styles.error}>Message de l’équipe Ojà : {exhibition.reviewNote}</p>
      ) : null}

      {exhibition.status === "PUBLISHED" ? (
        <p className={styles.muted}>
          Votre exposition est en ligne :{" "}
          <Link href={`/expositions/${exhibition.slug}`}>voir la page publique</Link> — partagez ce
          lien.
        </p>
      ) : null}

      <Panel title="Suivi">
        <ul className={editor.timeline}>
          {steps.map((step) => (
            <li key={step.label} className={step.done ? editor.done : editor.todo}>
              <span aria-hidden="true">{step.done ? "✓" : "○"}</span> {step.label}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Affiche, dossier et lieu">
        <div className={editor.files}>
          <div className={editor.file}>
            <strong>Affiche ou image de couverture</strong>
            {exhibition.coverUrl ? <img src={exhibition.coverUrl} alt="" /> : <span className={styles.muted}>Aucune image</span>}
            {editable ? <UploadButton label="Choisir une image" accept="image/jpeg,image/png,image/webp" disabled={busy} onFile={(file) => void attach("cover", file)} /> : null}
          </div>
          <div className={editor.file}>
            <strong>Dossier de présentation</strong>
            <span className={styles.muted}>
              {exhibition.hasDossier ? "Dossier transmis. Seule l’équipe Ojà le consulte." : "Facultatif : PDF ou images, 20 Mo au plus."}
            </span>
            {editable ? <UploadButton label={exhibition.hasDossier ? "Remplacer" : "Joindre un dossier"} accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onFile={(file) => void attach("dossier", file)} /> : null}
          </div>
          {exhibition.format !== "ONLINE" ? (
            <div className={editor.file}>
              <strong>Photos du lieu ({exhibition.venueImageUrls.length}/6)</strong>
              {exhibition.venueImageUrls[0] ? <img src={exhibition.venueImageUrls[0]} alt="" /> : null}
              {editable ? <UploadButton label="Ajouter une photo" accept="image/jpeg,image/png,image/webp" disabled={busy} onFile={(file) => void attach("venue", file)} /> : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <WorksEditor exhibition={exhibition} editable={editable} onChange={setExhibition} />

      <ExhibitionForm
        key={exhibition.status}
        exhibition={exhibition}
        disabled={!editable}
        submitLabel="Enregistrer les modifications"
        onSaved={setExhibition}
      />

      {editable ? (
        <Panel title="Soumettre à l’équipe Ojà">
          {exhibition.blockers.length > 0 ? (
            <>
              <p className={styles.muted}>Avant de soumettre :</p>
              <ul className={editor.blockers}>
                {exhibition.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.muted}>
              Votre dossier est complet. Une fois soumis, il ne se modifie plus pendant l’examen.
            </p>
          )}
          <div className={editor.actions}>
            <Button type="button" onClick={() => void submit()} disabled={busy || exhibition.blockers.length > 0}>
              Soumettre le dossier
            </Button>
          </div>
        </Panel>
      ) : null}

      {message ? <p className={styles.error}>{message}</p> : null}
    </>
  );
}

function UploadButton({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={editor.upload}>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      {label}
    </label>
  );
}
