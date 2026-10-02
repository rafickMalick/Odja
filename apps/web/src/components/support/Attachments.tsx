"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/Button";
import { workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { UploadError, uploadFile } from "@/lib/upload";

import support from "./support.module.css";

/** Au plus 5 pièces jointes par message, comme le contrat de l'API. */
export const MAX_ATTACHMENTS = 5;

export interface PendingAttachment {
  name: string;
  fileKey: string;
}

/**
 * Choix et envoi de pièces jointes (captures, photos, PDF).
 *
 * Chaque fichier part au stockage dès qu'il est choisi : au moment d'envoyer
 * le message, il ne reste qu'à transmettre les clés. Les bornes (format,
 * 8 Mo) sont vérifiées avant l'envoi, sur place.
 */
export function AttachmentPicker({
  value,
  onChange,
}: {
  value: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_ATTACHMENTS - value.length;
    if (files.length > room) {
      setError(`${MAX_ATTACHMENTS} pièces jointes au plus par message.`);
      return;
    }

    setBusy(true);
    const added: PendingAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        const { fileKey } = await uploadFile(file, "support-attachment");
        added.push({ name: file.name, fileKey });
      }
    } catch (cause) {
      setError(
        cause instanceof UploadError
          ? cause.message
          : "Envoi du fichier impossible pour le moment.",
      );
    } finally {
      onChange([...value, ...added]);
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className={support.fields}>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        hidden
        onChange={(event) => void pick(event.target.files)}
      />
      {value.length > 0 ? (
        <ul className={support.attachments}>
          {value.map((file) => (
            <li key={file.fileKey}>
              <span>{file.name}</span>
              <button
                type="button"
                className={support.linkButton}
                onClick={() => onChange(value.filter((other) => other.fileKey !== file.fileKey))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {value.length < MAX_ATTACHMENTS ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? "Envoi du fichier…" : "Joindre une capture ou une photo"}
          </Button>
        </div>
      ) : null}
      <p className={styles.muted}>JPEG, PNG, WebP ou PDF, 8 Mo au plus.</p>
    </div>
  );
}

/**
 * Pièces jointes d'un message : un lien de lecture temporaire est demandé au
 * clic. Les fichiers sont privés, aucune adresse permanente n'existe.
 */
export function AttachmentLinks({
  fileKeys,
  resolve,
}: {
  fileKeys: string[];
  resolve: (fileKey: string) => Promise<string>;
}) {
  const [error, setError] = useState<string | null>(null);

  if (fileKeys.length === 0) return null;

  const open = async (fileKey: string) => {
    setError(null);
    // La fenêtre s'ouvre tout de suite, au clic : ouverte après l'attente,
    // elle serait bloquée comme une fenêtre surgissante.
    const tab = window.open("", "_blank");
    try {
      const url = await resolve(fileKey);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError("Pièce jointe indisponible pour le moment.");
    }
  };

  return (
    <ul className={support.attachments}>
      {fileKeys.map((fileKey, index) => (
        <li key={fileKey}>
          <button type="button" className={support.linkButton} onClick={() => void open(fileKey)}>
            Pièce jointe {index + 1}
            {fileKey.endsWith(".pdf") ? " (PDF)" : ""}
          </button>
        </li>
      ))}
      {error ? <li className={support.time}>{error}</li> : null}
    </ul>
  );
}
