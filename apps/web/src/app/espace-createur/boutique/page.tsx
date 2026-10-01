"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { useToast } from "@/components/Toast";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { UploadError, uploadFile } from "@/lib/upload";

import { useMakerStatus } from "../maker-context";
import shop from "./shop.module.css";

/**
 * Boutique et dossier de validation.
 *
 * Une seule page pour les deux : le cahier client les sépare, mais un artisan
 * qui vient de créer sa boutique doit enchaîner sur son dossier sans chercher
 * un autre écran  et les champs que l'administration vérifie sont ceux du
 * formulaire de boutique.
 */

interface Profile {
  shopName: string;
  description: string | null;
  cityId: string;
  city: string;
  managerName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  ifuNumber: string | null;
  rccmNumber: string | null;
  pickupLine1: string | null;
  pickupLandmark: string | null;
  kycStatus: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  kycRejectReason: string | null;
  commissionBps: number;
}

interface City {
  id: string;
  name: string;
}

interface KycDocument {
  id: string;
  type: string;
  status: string;
  note: string | null;
  createdAt: string;
}

/** Les pièces attendues d'un atelier, dans l'ordre où on les demande. */
const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: "cni_recto", label: "Pièce d’identité  recto" },
  { value: "cni_verso", label: "Pièce d’identité  verso" },
  { value: "rccm", label: "Registre de commerce (RCCM)" },
  { value: "ifu", label: "Identifiant fiscal (IFU)" },
  { value: "autre", label: "Autre pièce" },
];

const KYC_STATE: Record<
  Profile["kycStatus"],
  { type: "pending" | "success" | "info" | "warning" | "danger"; label: string }
> = {
  NOT_SUBMITTED: { type: "pending", label: "Dossier non déposé" },
  PENDING: { type: "info", label: "En cours d’examen" },
  APPROVED: { type: "success", label: "Validé" },
  REJECTED: { type: "danger", label: "Refusé" },
};

export default function ShopPage() {
  const router = useRouter();
  const { notify } = useToast();
  const { refresh: refreshShell } = useMakerStatus();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [exists, setExists] = useState(true);
  const [cities, setCities] = useState<City[]>([]);
  const [documents, setDocuments] = useState<KycDocument[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cityList, docs] = await Promise.all([
      apiFetch<City[]>("/geo/cities").catch(() => []),
      apiFetch<KycDocument[]>("/maker/kyc/documents").catch(() => []),
    ]);
    setCities(cityList);
    setDocuments(docs);

    try {
      const mine = await apiFetch<Profile>("/maker/profile");
      setProfile(mine);
      setValues(toValues(mine));
    } catch (error) {
      /* 404 : le compte existe, la boutique pas encore. C'est le cas normal
         d'un créateur qui vient de s'inscrire, pas une erreur. */
      if (error instanceof ApiError && error.problem.status === 404) {
        setExists(false);
        setValues(EMPTY);
      } else {
        setMessage("Impossible de charger votre boutique.");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    const payload: Record<string, unknown> = {
      shopName: values["shopName"],
      cityId: values["cityId"],
      managerName: values["managerName"],
      contactPhone: values["contactPhone"],
      contactEmail: values["contactEmail"],
      postalAddress: values["postalAddress"],
      pickupLine1: values["pickupLine1"],
    };
    for (const key of ["description", "ifuNumber", "rccmNumber", "pickupLandmark"]) {
      if (values[key]?.trim()) payload[key] = values[key]!.trim();
    }

    try {
      const wasNew = !exists;
      await apiFetch("/maker/profile", {
        method: exists ? "PATCH" : "POST",
        body: payload,
      });
      setExists(true);
      setMessage("Boutique enregistrée.");
      notify("Boutique enregistrée.", { tone: "success" });
      await load();
      /* La coquille ne savait pas encore qu'une boutique existe : sans ce
         rappel, elle resterait sur « aucune boutique » jusqu'à un
         rechargement complet de la page. */
      if (wasNew) await refreshShell();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of error.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        const summary = error.problem.errors?.length
          ? "Quelques champs demandent une correction."
          : error.message;
        setMessage(summary);
        notify(summary, { tone: "error" });
      } else {
        setMessage("Enregistrement impossible.");
        notify("Enregistrement impossible.", { tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitKyc = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/maker/kyc/submit", { method: "POST" });
      await load();
      setMessage("Dossier déposé. L’équipe Ojà revient vers vous sous 48 h ouvrées.");
      notify("Dossier déposé  votre espace est maintenant accessible.", { tone: "success" });

      /* Le dépôt fait passer le statut à PENDING : la coquille se déverrouille.
         On ne laisse pas l'artisan planté sur cette page  c'est le moment de
         le conduire vers son tableau de bord. */
      await refreshShell();
      router.push("/espace-createur");
    } catch (error) {
      const summary = error instanceof ApiError ? error.message : "Dépôt impossible.";
      setMessage(summary);
      notify(summary, { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const locked = profile?.kycStatus === "PENDING";

  return (
    <>
      <PageHead
        title={exists ? "Ma boutique" : "Créer ma boutique"}
        subtitle={
          exists
            ? "Ce que voient vos acheteurs, et ce que l’équipe Ojà vérifie."
            : "Renseignez votre atelier. Les pièces justificatives viennent ensuite."
        }
        action={
          profile ? (
            <Badge type={KYC_STATE[profile.kycStatus].type}>
              {KYC_STATE[profile.kycStatus].label}
            </Badge>
          ) : undefined
        }
      />

      {profile?.kycStatus === "REJECTED" && profile.kycRejectReason ? (
        <p className={styles.error}>
          Dossier refusé : {profile.kycRejectReason}. Corrigez, puis redéposez-le.
        </p>
      ) : null}

      {message ? <p className={styles.muted}>{message}</p> : null}

      <form onSubmit={save} className={shop.form} noValidate>
        <Panel title="Vitrine publique">
          <p className={styles.muted}>
            Ces informations sont les seules visibles des acheteurs. Ni votre téléphone, ni
            votre e-mail, ni votre adresse ne leur sont montrés  Ojà reste l’intermédiaire.
          </p>

          <Field
            label="Nom de l’atelier"
            value={values["shopName"] ?? ""}
            onChange={(event) => set("shopName", event.target.value)}
            error={errors["shopName"]}
          />

          <Field label="Présentation" error={errors["description"]}>
            <textarea
              className={fieldStyles.control}
              rows={5}
              value={values["description"] ?? ""}
              onChange={(event) => set("description", event.target.value)}
              placeholder="Votre savoir-faire, vos matériaux, votre histoire…"
            />
          </Field>

          <Field label="Ville" error={errors["cityId"]}>
            <select
              className={fieldStyles.control}
              value={values["cityId"] ?? ""}
              onChange={(event) => set("cityId", event.target.value)}
            >
              <option value="">Choisir une ville</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </Field>
        </Panel>

        <Panel title="Informations réservées à Ojà">
          <Field
            label="Nom du responsable"
            value={values["managerName"] ?? ""}
            onChange={(event) => set("managerName", event.target.value)}
            error={errors["managerName"]}
          />

          <FieldRow>
            <Field
              label="Téléphone"
              type="tel"
              value={values["contactPhone"] ?? ""}
              onChange={(event) => set("contactPhone", event.target.value)}
              error={errors["contactPhone"]}
            />
            <Field
              label="E-mail"
              type="email"
              value={values["contactEmail"] ?? ""}
              onChange={(event) => set("contactEmail", event.target.value)}
              error={errors["contactEmail"]}
            />
          </FieldRow>

          <Field
            label="Adresse du siège"
            value={values["postalAddress"] ?? ""}
            onChange={(event) => set("postalAddress", event.target.value)}
            error={errors["postalAddress"]}
          />

          <FieldRow>
            <Field
              label="Numéro IFU"
              value={values["ifuNumber"] ?? ""}
              onChange={(event) => set("ifuNumber", event.target.value)}
              error={errors["ifuNumber"]}
            />
            <Field
              label="Numéro RCCM"
              value={values["rccmNumber"] ?? ""}
              onChange={(event) => set("rccmNumber", event.target.value)}
              error={errors["rccmNumber"]}
            />
          </FieldRow>
          <p className={styles.muted}>L’un des deux suffit pour déposer votre dossier.</p>
        </Panel>

        <Panel title="Adresse d’enlèvement">
          <p className={styles.muted}>
            C’est là que le livreur se présente. Elle peut différer de l’adresse du siège.
          </p>

          <Field
            label="Adresse de l’atelier"
            value={values["pickupLine1"] ?? ""}
            onChange={(event) => set("pickupLine1", event.target.value)}
            error={errors["pickupLine1"]}
          />
          <Field
            label="Point de repère (facultatif)"
            value={values["pickupLandmark"] ?? ""}
            onChange={(event) => set("pickupLandmark", event.target.value)}
            placeholder="En face de la pharmacie Sègbeya"
            error={errors["pickupLandmark"]}
          />
        </Panel>

        <div className={shop.actions}>
          <Button type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : exists ? "Enregistrer" : "Créer ma boutique"}
          </Button>
        </div>
      </form>

      {exists ? (
        <>
          <KycDocuments documents={documents} onChange={setDocuments} disabled={locked} />

          <Panel title="Dépôt du dossier">
            {profile?.kycStatus === "APPROVED" ? (
              <p className={styles.muted}>
                Votre atelier est validé. Vous pouvez mettre vos pièces en vente.
              </p>
            ) : locked ? (
              <p className={styles.muted}>
                Dossier en cours d’examen. Vous recevrez un e-mail dès la décision.
              </p>
            ) : (
              <>
                <p className={styles.muted}>
                  Il faut le nom du responsable, un téléphone, l’adresse du siège, celle de
                  l’atelier, et un numéro IFU ou RCCM. Vos pièces justificatives ne sont
                  visibles que de l’équipe de validation.
                </p>
                <div className={shop.actions}>
                  <Button type="button" onClick={submitKyc} disabled={busy}>
                    Déposer mon dossier
                  </Button>
                </div>
              </>
            )}
          </Panel>
        </>
      ) : null}
    </>
  );
}

/** Envoi et suivi des pièces justificatives. */
function KycDocuments({
  documents,
  onChange,
  disabled,
}: {
  documents: KycDocument[];
  onChange: (documents: KycDocument[]) => void;
  disabled: boolean;
}) {
  const [type, setType] = useState(DOCUMENT_TYPES[0]!.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { fileKey } = await uploadFile(file, "kyc-document");
      onChange(
        await apiFetch<KycDocument[]>("/maker/kyc/documents", {
          method: "POST",
          body: { fileKey, type },
        }),
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof UploadError
          ? uploadError.message
          : "L’envoi a échoué. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Pièces justificatives">
      {documents.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pièce</th>
                <th>État</th>
                <th>Déposée le</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>
                    {DOCUMENT_TYPES.find((item) => item.value === document.type)?.label ??
                      document.type}
                  </td>
                  <td>
                    {document.status === "APPROVED" ? (
                      <Badge type="success">Acceptée</Badge>
                    ) : document.status === "REJECTED" ? (
                      <Badge type="danger">Refusée</Badge>
                    ) : (
                      <Badge type="pending">En attente</Badge>
                    )}
                    {document.note ? <p className={styles.muted}>{document.note}</p> : null}
                  </td>
                  <td>{new Date(document.createdAt).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.muted}>Aucune pièce déposée pour l’instant.</p>
      )}

      {!disabled ? (
        <div className={shop.upload}>
          <select
            className={fieldStyles.control}
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Type de pièce"
          >
            {DOCUMENT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <label className={shop.uploadButton}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void send(file);
                event.target.value = "";
              }}
            />
            {busy ? "Envoi…" : "Choisir un fichier"}
          </label>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
    </Panel>
  );
}

const EMPTY: Record<string, string> = {
  shopName: "",
  description: "",
  cityId: "",
  managerName: "",
  contactPhone: "",
  contactEmail: "",
  postalAddress: "",
  ifuNumber: "",
  rccmNumber: "",
  pickupLine1: "",
  pickupLandmark: "",
};

function toValues(profile: Profile): Record<string, string> {
  return {
    shopName: profile.shopName,
    description: profile.description ?? "",
    cityId: profile.cityId,
    managerName: profile.managerName ?? "",
    contactPhone: profile.contactPhone ?? "",
    contactEmail: profile.contactEmail ?? "",
    postalAddress: profile.postalAddress ?? "",
    ifuNumber: profile.ifuNumber ?? "",
    rccmNumber: profile.rccmNumber ?? "",
    pickupLine1: profile.pickupLine1 ?? "",
    pickupLandmark: profile.pickupLandmark ?? "",
  };
}
