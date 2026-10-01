"use client";

import { useRef, useState } from "react";

import { Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { UploadError, uploadFile } from "@/lib/upload";

import form from "./form.module.css";

/**
 * Photos d'une fiche : trois au minimum, cinq au maximum.
 *
 * Le fichier part directement au stockage, l'API ne reçoit que la clé. Les
 * envois sont séquentiels : cinq PUT simultanés depuis un téléphone en 3G
 * n'accélèrent rien et font échouer les derniers.
 */

interface Image {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

const MAX_PHOTOS = 5;

export function PhotoGallery({
  productId,
  images,
  onChange,
}: {
  productId: string;
  images: Image[];
  onChange: (images: Image[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = MAX_PHOTOS - images.length;

  const add = async (files: FileList | File[]) => {
    const chosen = Array.from(files).slice(0, room);
    if (chosen.length === 0) return;

    setBusy(true);
    setError(null);

    try {
      let latest = images;
      for (const file of chosen) {
        const { fileKey } = await uploadFile(file, "product-image");
        latest = await apiFetch<Image[]>(`/maker/products/${productId}/images`, {
          method: "POST",
          body: { fileKey, alt: file.name.replace(/\.[^.]+$/, "") },
        });
      }
      onChange(latest);
    } catch (uploadError) {
      setError(
        uploadError instanceof UploadError
          ? uploadError.message
          : "L’envoi a échoué. Réessayez.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (imageId: string) => {
    setBusy(true);
    try {
      onChange(
        await apiFetch<Image[]>(`/maker/products/${productId}/images/${imageId}`, {
          method: "DELETE",
        }),
      );
    } catch {
      setError("Suppression impossible.");
    } finally {
      setBusy(false);
    }
  };

  /* Réordonner par flèches plutôt que par glisser-déposer : le glisser marche
     mal au doigt, et la seule décision qui compte ici est « laquelle en
     premier ». */
  const moveFirst = async (imageId: string) => {
    setBusy(true);
    const order = [imageId, ...images.map((image) => image.id).filter((id) => id !== imageId)];
    try {
      onChange(
        await apiFetch<Image[]>(`/maker/products/${productId}/images/order`, {
          method: "PATCH",
          body: { imageIds: order },
        }),
      );
    } catch {
      setError("Réorganisation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`Photos (${images.length} / ${MAX_PHOTOS})`}>
      <p className={styles.muted}>
        Trois photos au minimum. La première est celle qui apparaît au catalogue  montrez la
        pièce entière, sur fond neutre.
      </p>

      <div className={form.gallery}>
        {images.map((image, index) => (
          <div key={image.id} className={form.photo}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt ?? ""} />
            {index === 0 ? (
              <span className={form.cover}>Vignette</span>
            ) : (
              <button
                type="button"
                className={form.cover}
                onClick={() => void moveFirst(image.id)}
                disabled={busy}
              >
                Mettre en vignette
              </button>
            )}
            <button
              type="button"
              className={form.photoRemove}
              aria-label="Retirer cette photo"
              onClick={() => void remove(image.id)}
              disabled={busy}
            >
              ×
            </button>
          </div>
        ))}

        {room > 0 ? (
          <label
            className={form.dropzone}
            data-over={over || undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              void add(event.dataTransfer.files);
            }}
          >
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy}
              onChange={(event) => event.target.files && void add(event.target.files)}
            />
            <span>{busy ? "Envoi…" : "Ajouter une photo"}</span>
            <span className={form.dropHint}>JPEG, PNG ou WEBP · 10 Mo max</span>
          </label>
        ) : null}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
    </Panel>
  );
}
