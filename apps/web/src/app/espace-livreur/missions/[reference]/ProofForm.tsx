"use client";

import { DELIVERY_GPS_ENABLED } from "@oja/contracts";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import {
  FieldCard,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
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
 * du client, et in fine le versement au créateur. **Le code du client suffit** :
 * le livreur le tape, et c'est confirmé. Sans code, le serveur exige une photo
 * et la position.
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
  const [position, setPosition] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locating, setLocating] = useState(DELIVERY_GPS_ENABLED);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Localisation en pause : on ne la demande même pas au téléphone.
    if (!DELIVERY_GPS_ENABLED) return;
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
  const provided = [otpReady, photoKey !== null, position !== null].filter(
    Boolean,
  ).length;
  const required = DELIVERY_GPS_ENABLED ? 2 : 1;
  const proven = otpReady || provided >= required;
  const enough = proven && (cashToCollectXof === 0 || cashCollected);
  const [showFallback, setShowFallback] = useState(false);

  const sendPhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { fileKey } = await uploadFile(file, "delivery-proof");
      setPhotoKey(fileKey);
    } catch (cause) {
      setError(
        cause instanceof UploadError
          ? cause.message
          : "L’envoi de la photo a échoué.",
      );
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
          ...(cashToCollectXof > 0 && cashCollected
            ? { cashCollectedXof: cashToCollectXof }
            : {}),
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
        Demandez au client son code à 4 chiffres : il l’a dans sa commande, sur
        le site. Tapez-le ci-dessous et confirmez.
      </p>

      {cashToCollectXof > 0 ? (
        <label className={proof.photoButton} style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={cashCollected}
            onChange={(event) => setCashCollected(event.target.checked)}
          />
          J’ai encaissé {formatFcfa(cashToCollectXof)} en espèces auprès du
          client
        </label>
      ) : null}

      <div className={proof.codeField}>
        <Field
          label="Code du client (4 chiffres)"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={otp}
          onChange={(event) =>
            setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))
          }
          placeholder="1234"
        />
      </div>

      {/* Client injoignable ou sans code : photo (+ position, si la
          localisation est active) prennent le relais. */}
      {!showFallback ? (
        <button
          type="button"
          className={proof.fallbackLink}
          onClick={() => setShowFallback(true)}
        >
          Le client n’a pas son code ?
        </button>
      ) : (
        <>
          <ol className={proof.checklist}>
            <li data-done={photoKey !== null || undefined}>
              Photo du colis remis
            </li>
            {DELIVERY_GPS_ENABLED ? (
              <li data-done={position !== null || undefined}>
                Position{" "}
                {locating
                  ? ": recherche en cours…"
                  : position
                    ? ""
                    : ": indisponible"}
              </li>
            ) : null}
          </ol>
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
            {uploading
              ? "Envoi de la photo…"
              : photoKey
                ? "Reprendre la photo"
                : "Prendre une photo"}
          </label>
        </>
      )}

      {error ? <p className={styles.error}>{error}</p> : null}

      <Button
        type="button"
        fullWidth
        disabled={!enough || busy}
        onClick={() => void submit()}
      >
        {busy
          ? "Enregistrement…"
          : enough
            ? "Confirmer la remise"
            : proven
              ? "Encaissez d’abord le montant"
              : showFallback
                ? DELIVERY_GPS_ENABLED
                  ? `Encore ${required - provided} élément${required - provided > 1 ? "s" : ""}`
                  : "Prenez une photo du colis remis"
                : "Saisissez le code du client"}
      </Button>
    </FieldCard>
  );
}
