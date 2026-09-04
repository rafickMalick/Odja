"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import {
  FieldCard,
  FieldHead,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
import { ApiError, apiFetch } from "@/lib/api";
import { UploadError, uploadFile } from "@/lib/upload";

import profileStyles from "./profil.module.css";

/**
 * Profil et dossier du livreur.
 *
 * Trois pièces sont exigées avant de recevoir la moindre mission : identité,
 * permis, carte grise. C'est le seul écran de l'espace où l'on saisit ; tout
 * le reste se fait au pouce, en mouvement.
 */

interface CourierProfile {
  id: string;
  fullName: string;
  vehicle: "MOTO" | "TRICYCLE" | "CAMIONNETTE";
  plateNumber: string | null;
  payoutMsisdn: string | null;
  payoutOperator: string | null;
  isAvailable: boolean;
  ratingAvg: number;
  kycStatus: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  kycRejectReason: string | null;
  deliveredCount: number;
}

interface Document {
  id: string;
  type: string;
  status: string;
  note: string | null;
  createdAt: string;
}

const VEHICLES = [
  { value: "MOTO", label: "Moto" },
  { value: "TRICYCLE", label: "Tricycle" },
  { value: "CAMIONNETTE", label: "Camionnette" },
];

/** Les pièces attendues d'un livreur — différentes de celles d'un atelier. */
const DOCUMENT_TYPES = [
  { value: "cni_recto", label: "Pièce d’identité — recto", required: true },
  { value: "cni_verso", label: "Pièce d’identité — verso", required: false },
  { value: "permis", label: "Permis de conduire", required: true },
  { value: "carte_grise", label: "Carte grise du véhicule", required: true },
];

const KYC_STATE: Record<
  CourierProfile["kycStatus"],
  { type: "pending" | "success" | "info" | "danger"; label: string }
> = {
  NOT_SUBMITTED: { type: "pending", label: "Dossier non déposé" },
  PENDING: { type: "info", label: "En cours d’examen" },
  APPROVED: { type: "success", label: "Validé" },
  REJECTED: { type: "danger", label: "Refusé" },
};

export default function CourierProfilePage() {
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [exists, setExists] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [vehicle, setVehicle] = useState("MOTO");
  const [plateNumber, setPlateNumber] = useState("");
  const [payoutMsisdn, setPayoutMsisdn] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await apiFetch<CourierProfile>("/courier/profile");
      setProfile(mine);
      setVehicle(mine.vehicle);
      setPlateNumber(mine.plateNumber ?? "");
      setPayoutMsisdn(mine.payoutMsisdn ?? "");
      setDocuments(await apiFetch<Document[]>("/courier/kyc/documents").catch(() => []));
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 404) {
        setExists(false);
      } else {
        setMessage("Impossible de charger votre profil.");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    const payload: Record<string, unknown> = { vehicle, plateNumber };
    if (payoutMsisdn.trim()) payload["payoutMsisdn"] = payoutMsisdn.trim();

    try {
      await apiFetch("/courier/profile", {
        method: exists ? "PATCH" : "POST",
        body: payload,
      });
      setExists(true);
      setMessage("Profil enregistré.");
      await load();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of error.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(error.problem.errors?.length ? null : error.message);
      } else {
        setMessage("Enregistrement impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitKyc = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/courier/kyc/submit", { method: "POST" });
      await load();
      setMessage("Dossier déposé. Ojà revient vers vous sous 48 h ouvrées.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Dépôt impossible.");
    } finally {
      setBusy(false);
    }
  };

  const locked = profile?.kycStatus === "PENDING";
  const deposited = new Set(documents.map((document) => document.type));

  return (
    <>
      <FieldHead
        title={exists ? "Mon profil" : "Créer mon profil"}
        subtitle={
          exists
            ? profile?.fullName
            : "Votre véhicule décide des courses que vous pouvez prendre."
        }
      />

      {profile ? (
        <FieldCard>
          <div className={styles.rows}>
            <div>
              <span>Dossier</span>
              <Badge type={KYC_STATE[profile.kycStatus].type}>
                {KYC_STATE[profile.kycStatus].label}
              </Badge>
            </div>
            <div>
              <span>Courses livrées</span>
              <strong>{profile.deliveredCount}</strong>
            </div>
            {profile.ratingAvg > 0 ? (
              <div>
                <span>Note</span>
                <strong>{profile.ratingAvg.toFixed(1)} / 5</strong>
              </div>
            ) : null}
          </div>
          {profile.kycStatus === "REJECTED" && profile.kycRejectReason ? (
            <p className={styles.error}>Refusé : {profile.kycRejectReason}</p>
          ) : null}
        </FieldCard>
      ) : null}

      {message ? <p className={styles.muted}>{message}</p> : null}

      <form onSubmit={save}>
        <FieldCard>
          <h2 className={styles.subtitle}>Véhicule</h2>

          <Field label="Type de véhicule" error={errors["vehicle"]}>
            <select
              className={fieldStyles.control}
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
            >
              {VEHICLES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <p className={styles.muted}>
            Changer de véhicule après validation renvoie votre dossier en vérification : c’est
            la carte grise qui a été contrôlée.
          </p>

          <Field
            label="Immatriculation"
            value={plateNumber}
            onChange={(event) => setPlateNumber(event.target.value.toUpperCase())}
            placeholder="AB 1234 CI"
            error={errors["plateNumber"]}
          />

          <Field
            label="Numéro Mobile Money pour vos gains"
            type="tel"
            value={payoutMsisdn}
            onChange={(event) => setPayoutMsisdn(event.target.value)}
            placeholder="+225 07 00 00 00 00"
            error={errors["payoutMsisdn"]}
          />

          <Button type="submit" fullWidth disabled={busy}>
            {busy ? "Enregistrement…" : exists ? "Enregistrer" : "Créer mon profil"}
          </Button>
        </FieldCard>
      </form>

      {exists ? (
        <>
          <FieldCard>
            <h2 className={styles.subtitle}>Mes pièces</h2>
            <p className={styles.muted}>
              Elles ne sont lisibles que par l’équipe de validation d’Ojà.
            </p>

            <ul className={profileStyles.documents}>
              {DOCUMENT_TYPES.map((type) => {
                const document = documents.find((item) => item.type === type.value);
                return (
                  <li key={type.value} data-done={document ? true : undefined}>
                    <div>
                      <strong>{type.label}</strong>
                      {!type.required ? (
                        <span className={styles.muted}> — facultatif</span>
                      ) : null}
                      {document?.note ? (
                        <p className={styles.muted}>{document.note}</p>
                      ) : null}
                    </div>
                    {locked ? (
                      <span className={styles.muted}>{document ? "Déposée" : "Manquante"}</span>
                    ) : (
                      <DocumentUpload
                        type={type.value}
                        hasFile={document !== undefined}
                        onUploaded={setDocuments}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </FieldCard>

          <FieldCard>
            {profile?.kycStatus === "APPROVED" ? (
              <p className={styles.success}>
                Dossier validé. Déclarez-vous disponible pour recevoir des missions.
              </p>
            ) : locked ? (
              <p className={styles.muted}>
                Dossier en cours d’examen. Vous recevrez un e-mail dès la décision.
              </p>
            ) : (
              <>
                <p className={styles.muted}>
                  Il faut votre immatriculation, une pièce d’identité, votre permis et la carte
                  grise du véhicule.
                </p>
                <Button
                  type="button"
                  fullWidth
                  disabled={busy || !plateNumber || deposited.size < 3}
                  onClick={() => void submitKyc()}
                >
                  Déposer mon dossier
                </Button>
              </>
            )}
          </FieldCard>
        </>
      ) : null}
    </>
  );
}

function DocumentUpload({
  type,
  hasFile,
  onUploaded,
}: {
  type: string;
  hasFile: boolean;
  onUploaded: (documents: Document[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { fileKey } = await uploadFile(file, "kyc-document");
      onUploaded(
        await apiFetch<Document[]>("/courier/kyc/documents", {
          method: "POST",
          body: { fileKey, type },
        }),
      );
    } catch (cause) {
      setError(cause instanceof UploadError ? cause.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className={profileStyles.upload}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
            event.target.value = "";
          }}
        />
        {busy ? "…" : hasFile ? "Remplacer" : "Envoyer"}
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
    </>
  );
}
