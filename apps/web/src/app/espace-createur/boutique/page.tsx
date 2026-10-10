"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { useToast } from "@/components/Toast";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import type { CreatorKind } from "@oja/contracts";

import { ApiError, apiFetch } from "@/lib/api";
import { CREATOR_KIND_LABELS, CREATOR_KINDS, isApprenticeKind } from "@/lib/creators";
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
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  creatorKind: CreatorKind;
  activityField: string | null;
  specialties: string[];
  techniques: string[];
  services: string | null;
  region: string | null;
  publicArea: string | null;
  trainingInstitution: string | null;
  trainingSpecialty: string | null;
  trainingLevel: string | null;
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
  suspendedAt: string | null;
  suspendReason: string | null;
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
  { value: "cni_recto", label: "Pièce d’identité (recto)" },
  { value: "cni_verso", label: "Pièce d’identité (verso)" },
  { value: "rccm", label: "Registre de commerce (RCCM)" },
  { value: "ifu", label: "Identifiant fiscal (IFU)" },
  { value: "justificatif_formation", label: "Justificatif de formation" },
  { value: "autre", label: "Autre pièce" },
];

/* Un apprenti commence par son justificatif : c'est la pièce que l'équipe
   examine en premier, et la seule qui lui soit propre. */
const APPRENTICE_DOCUMENT_TYPES = [
  DOCUMENT_TYPES.find((item) => item.value === "justificatif_formation")!,
  ...DOCUMENT_TYPES.filter(
    (item) => item.value !== "justificatif_formation" && item.value !== "rccm" && item.value !== "ifu",
  ),
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
    for (const key of [
      "description",
      "ifuNumber",
      "rccmNumber",
      "pickupLandmark",
      "activityField",
      "services",
      "region",
      "publicArea",
      "trainingInstitution",
      "trainingSpecialty",
      "trainingLevel",
    ]) {
      if (values[key]?.trim()) payload[key] = values[key]!.trim();
    }
    payload["creatorKind"] = values["creatorKind"] ?? "ARTISAN";
    payload["specialties"] = splitTags(values["specialties"]);
    payload["techniques"] = splitTags(values["techniques"]);

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
      notify("Dossier déposé : votre espace est maintenant accessible.", { tone: "success" });

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
  const apprentice = isApprenticeKind(values["creatorKind"]);

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

      {profile?.suspendedAt ? (
        <p className={styles.error}>
          Votre profil est suspendu : {profile.suspendReason}. Il n’est plus visible des acheteurs.
          Écrivez au support créateur pour en parler.
        </p>
      ) : null}

      {message ? <p className={styles.muted}>{message}</p> : null}

      <form onSubmit={save} className={shop.form} noValidate>
        <Panel title="Vitrine publique">
          <p className={styles.muted}>
            Ces informations sont les seules visibles des acheteurs. Ni votre téléphone, ni
            votre e-mail, ni votre adresse ne leur sont montrés : Ojà reste l’intermédiaire.
          </p>

          <Field
            label="Nom de l’atelier ou de l’entreprise"
            value={values["shopName"] ?? ""}
            onChange={(event) => set("shopName", event.target.value)}
            error={errors["shopName"]}
          />

          <FieldRow>
            <Field label="Statut" error={errors["creatorKind"]}>
              <select
                className={fieldStyles.control}
                value={values["creatorKind"] ?? "ARTISAN"}
                onChange={(event) => set("creatorKind", event.target.value)}
              >
                {CREATOR_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CREATOR_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Domaine d’activité"
              value={values["activityField"] ?? ""}
              onChange={(event) => set("activityField", event.target.value)}
              placeholder="Mobilier, céramique, textile…"
              error={errors["activityField"]}
            />
          </FieldRow>

          <Field label="Présentation" error={errors["description"]}>
            <textarea
              className={fieldStyles.control}
              rows={5}
              value={values["description"] ?? ""}
              onChange={(event) => set("description", event.target.value)}
              placeholder="Votre parcours, votre démarche, votre histoire…"
            />
          </Field>

          <Field
            label="Spécialités"
            value={values["specialties"] ?? ""}
            onChange={(event) => set("specialties", event.target.value)}
            placeholder="Assises, tables basses, luminaires"
            error={errors["specialties"]}
          />
          <Field
            label="Matériaux et techniques"
            value={values["techniques"] ?? ""}
            onChange={(event) => set("techniques", event.target.value)}
            placeholder="Iroko, tressage, teinture à l’indigo"
            error={errors["techniques"]}
          />
          <p className={styles.muted}>Séparez-les par des virgules. Douze au maximum.</p>

          <Field label="Services proposés (facultatif)" error={errors["services"]}>
            <textarea
              className={fieldStyles.control}
              rows={3}
              value={values["services"] ?? ""}
              onChange={(event) => set("services", event.target.value)}
              placeholder="Pièces sur mesure, restauration, ateliers de formation…"
            />
          </Field>

          <p className={styles.muted}>
            Pas de numéro de téléphone, d’e-mail ni de lien WhatsApp dans ces textes : ils
            seraient refusés. Les acheteurs vous contactent par Ojà.
          </p>

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

          <FieldRow>
            <Field
              label="Région (facultatif)"
              value={values["region"] ?? ""}
              onChange={(event) => set("region", event.target.value)}
              placeholder="Littoral"
              error={errors["region"]}
            />
            <Field
              label="Quartier affiché (facultatif)"
              value={values["publicArea"] ?? ""}
              onChange={(event) => set("publicArea", event.target.value)}
              placeholder="Haie Vive"
              error={errors["publicArea"]}
            />
          </FieldRow>
          <p className={styles.muted}>
            Le quartier aide les acheteurs à vous situer. Votre adresse exacte n’est jamais publiée.
          </p>
        </Panel>

        {apprentice ? (
          <Panel title="Votre formation">
            <p className={styles.muted}>
              Votre profil affichera honnêtement « {CREATOR_KIND_LABELS[values["creatorKind"] as CreatorKind]} ».
              Ces informations présentent votre parcours aux visiteurs ; votre justificatif, lui,
              n’est vu que par l’équipe de validation. Le profil d’apprenti est gratuit.
            </p>
            <Field
              label="Établissement ou atelier de formation"
              value={values["trainingInstitution"] ?? ""}
              onChange={(event) => set("trainingInstitution", event.target.value)}
              placeholder="École, centre de formation, atelier d’un maître artisan…"
              error={errors["trainingInstitution"]}
            />
            <FieldRow>
              <Field
                label="Spécialité"
                value={values["trainingSpecialty"] ?? ""}
                onChange={(event) => set("trainingSpecialty", event.target.value)}
                placeholder="Design produit, ébénisterie, vannerie…"
                error={errors["trainingSpecialty"]}
              />
              <Field
                label="Niveau (facultatif)"
                value={values["trainingLevel"] ?? ""}
                onChange={(event) => set("trainingLevel", event.target.value)}
                placeholder="Deuxième année, apprentissage depuis 2024…"
                error={errors["trainingLevel"]}
              />
            </FieldRow>
          </Panel>
        ) : null}

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
          <p className={styles.muted}>
            {apprentice
              ? "Facultatifs pour un apprenti : votre justificatif de formation en tient lieu. Ces numéros ne sont jamais publiés."
              : "L’un des deux suffit pour déposer votre dossier. Ils ne sont jamais publiés."}
          </p>
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

      {exists && profile ? (
        <ShopImages logoUrl={profile.logoUrl} coverUrl={profile.coverUrl} onChange={setProfile} />
      ) : null}

      {profile?.kycStatus === "APPROVED" ? (
        <p className={styles.muted}>
          <a href={`/atelier/${profile.slug}`} target="_blank" rel="noreferrer">
            Voir mon profil public
          </a>
        </p>
      ) : null}

      {exists ? (
        <>
          <KycDocuments
            documents={documents}
            onChange={setDocuments}
            disabled={locked}
            types={apprentice ? APPRENTICE_DOCUMENT_TYPES : DOCUMENT_TYPES}
          />

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
                  {apprentice
                    ? "Il faut votre nom, un téléphone, l’adresse où retirer vos pièces, votre établissement, votre spécialité et votre justificatif de formation."
                    : "Il faut le nom du responsable, un téléphone, l’adresse du siège, celle de l’atelier, et un numéro IFU ou RCCM."}{" "}
                  Vos pièces justificatives ne sont visibles que de l’équipe de validation.
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

/**
 * Logo et bannière.
 *
 * Deux emplacements, deux gestes : envoyer remplace l'image en place, retirer
 * la supprime. Le fichier part directement au stockage ; l'API ne fait que
 * rattacher la clé.
 */
function ShopImages({
  logoUrl,
  coverUrl,
  onChange,
}: {
  logoUrl: string | null;
  coverUrl: string | null;
  onChange: (profile: Profile) => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState<"logo" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (slot: "logo" | "cover", file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const { fileKey } = await uploadFile(file, "shop-image");
      onChange(
        await apiFetch<Profile>("/maker/profile/images", {
          method: "POST",
          body: { slot, fileKey },
        }),
      );
      notify(slot === "logo" ? "Logo mis à jour." : "Bannière mise à jour.", { tone: "success" });
    } catch (uploadError) {
      setError(
        uploadError instanceof UploadError || uploadError instanceof ApiError
          ? uploadError.message
          : "L’envoi a échoué. Réessayez.",
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot: "logo" | "cover") => {
    setBusy(slot);
    setError(null);
    try {
      onChange(await apiFetch<Profile>(`/maker/profile/images/${slot}`, { method: "DELETE" }));
    } catch {
      setError("Suppression impossible. Réessayez.");
    } finally {
      setBusy(null);
    }
  };

  const slots: { slot: "logo" | "cover"; label: string; hint: string; url: string | null }[] = [
    {
      slot: "logo",
      label: "Logo ou photo",
      hint: "Carré, au moins 400 × 400 px. Un logo pour une entreprise, une photo pour un créateur indépendant.",
      url: logoUrl,
    },
    {
      slot: "cover",
      label: "Bannière",
      hint: "Paysage, au moins 1600 × 500 px : votre atelier, une pièce emblématique, votre univers.",
      url: coverUrl,
    },
  ];

  return (
    <Panel title="Logo et bannière">
      <div className={shop.images}>
        {slots.map((item) => (
          <div key={item.slot} className={shop.imageSlot}>
            <div className={item.slot === "logo" ? shop.logoPreview : shop.coverPreview}>
              {item.url ? <img src={item.url} alt="" /> : <span>Aucune image</span>}
            </div>
            <div className={shop.imageText}>
              <p className={shop.imageLabel}>{item.label}</p>
              <p className={styles.muted}>{item.hint}</p>
              <div className={shop.actions}>
                <label className={shop.uploadButton}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void send(item.slot, file);
                      event.target.value = "";
                    }}
                  />
                  {busy === item.slot ? "Envoi…" : item.url ? "Remplacer" : "Choisir une image"}
                </label>
                {item.url ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void remove(item.slot)}
                  >
                    Retirer
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </Panel>
  );
}

/** Envoi et suivi des pièces justificatives. */
function KycDocuments({
  documents,
  onChange,
  disabled,
  types,
}: {
  documents: KycDocument[];
  onChange: (documents: KycDocument[]) => void;
  disabled: boolean;
  types: { value: string; label: string }[];
}) {
  const [type, setType] = useState(types[0]!.value);
  /* Le statut peut changer pendant la saisie : le type choisi suit la liste. */
  useEffect(() => {
    setType(types[0]!.value);
  }, [types]);
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
            {types.map((item) => (
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
  creatorKind: "ARTISAN",
  activityField: "",
  specialties: "",
  techniques: "",
  services: "",
  region: "",
  publicArea: "",
  trainingInstitution: "",
  trainingSpecialty: "",
  trainingLevel: "",
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

/** « Iroko, tressage , » → ["Iroko", "tressage"] */
function splitTags(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toValues(profile: Profile): Record<string, string> {
  return {
    creatorKind: profile.creatorKind,
    activityField: profile.activityField ?? "",
    specialties: profile.specialties.join(", "),
    techniques: profile.techniques.join(", "),
    services: profile.services ?? "",
    region: profile.region ?? "",
    publicArea: profile.publicArea ?? "",
    trainingInstitution: profile.trainingInstitution ?? "",
    trainingSpecialty: profile.trainingSpecialty ?? "",
    trainingLevel: profile.trainingLevel ?? "",
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
