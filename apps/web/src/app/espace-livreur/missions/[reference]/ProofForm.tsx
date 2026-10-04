"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { FieldCard, fieldShellStyles as styles } from "@/components/dashboard/FieldShell";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";
import { UploadError, uploadFile } from "@/lib/upload";

import { currentPosition } from "../../mission";
import proof from "./proof.module.css";

/**
 * Preuve de remise.
 *
 * C'est le verrou du circuit financier : c'est cette remise qui fait basculer
 * la sous-commande en « livrée », déclenche le compte à rebours de validation
 * du client, et in fine le versement au créateur. Le serveur exige **deux
 * éléments sur trois**  code du client, photo, position  et refuse la remise
 * en dessous.
 *
 * L'écran reproduit ce décompte en direct plutôt que de laisser le livreur
 * découvrir le refus après avoir tout saisi. La position est relevée dès
 * l'ouverture, en tâche de fond : c'est l'élément le plus lent à obtenir, et
 * le plus facile à obtenir sans rien demander à personne.
 */
export function ProofForm({
  reference,
  cashToCollectXof,
  onDelivered,
}: {
  reference: string;
  /** Espèces à encaisser avant de pouvoir clore la remise (0 = rien à encaisser). */
  cashToCollectXof: number;
  onDelivered: () => Promise<void>;
}) {
  const [cashCollected, setCashCollected] = useState(false);
  const [otp, setOtp] = useState("");
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void currentPosition().then((point) => {
      if (cancelled) return;
      setPosition(point);
      setLocating(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const otpReady = /^\d{4}$/.test(otp);
  const provided = [otpReady, photoKey !== null, position !== null].filter(Boolean).length;
  const enough = provided >= 2 && (cashToCollectXof === 0 || cashCollected);

  const sendPhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { fileKey } = await uploadFile(file, "delivery-proof");
      setPhotoKey(fileKey);
    } catch (cause) {
      setError(cause instanceof UploadError ? cause.message : "L’envoi de la photo a échoué.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/courier/missions/${reference}/deliver`, {
        method: "POST",
        body: {
          ...(otpReady ? { otp } : {}),
          ...(photoKey ? { photoKey } : {}),
          ...(position ?? {}),
          // Le serveur exige le montant exact : on déclare ce qui a été demandé.
          ...(cashToCollectXof > 0 && cashCollected ? { cashCollectedXof: cashToCollectXof } : {}),
        },
      });
      await onDelivered();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Remise refusée.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldCard tone="action">
      <h2 className={styles.subtitle}>Remise au client</h2>
      <p className={styles.muted}>
        Deux éléments sur trois sont nécessaires. Le code est celui que le client a reçu par
        message.
      </p>

      <ol className={proof.checklist}>
        <li data-done={otpReady || undefined}>Code du client</li>
        <li data-done={photoKey !== null || undefined}>Photo du colis remis</li>
        <li data-done={position !== null || undefined}>
          Position {locating ? ": recherche en cours…" : position ? "" : ": indisponible"}
        </li>
      </ol>

      {cashToCollectXof > 0 ? (
        <label className={proof.photoButton} style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={cashCollected}
            onChange={(event) => setCashCollected(event.target.checked)}
          />
          J’ai encaissé {formatFcfa(cashToCollectXof)} en espèces auprès du client
        </label>
      ) : null}

      <Field
        label="Code à 4 chiffres"
        inputMode="numeric"
        maxLength={4}
        value={otp}
        onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))}
        placeholder="1234"
      />

      <label className={proof.photoButton}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          /* `capture` ouvre directement l'appareil photo arrière : le livreur
             prend la photo sur place, il ne va pas la chercher dans sa
             galerie. */
          capture="environment"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void sendPhoto(file);
            event.target.value = "";
          }}
        />
        {uploading ? "Envoi de la photo…" : photoKey ? "Reprendre la photo" : "Prendre une photo"}
      </label>

      {error ? <p className={styles.error}>{error}</p> : null}

      <Button type="button" fullWidth disabled={!enough || busy} onClick={() => void submit()}>
        {busy
          ? "Enregistrement…"
          : enough
            ? "Confirmer la remise"
            : provided >= 2
              ? "Encaissez d’abord le montant"
              : `Encore ${2 - provided} élément${2 - provided > 1 ? "s" : ""}`}
      </Button>
    </FieldCard>
  );
}
