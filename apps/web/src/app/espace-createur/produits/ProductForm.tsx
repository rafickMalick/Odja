"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa, formatNumber } from "@/lib/format";

import form from "./form.module.css";

/**
 * Fiche d'une pièce.
 *
 * Deux choses que le cahier client ne demandait pas figurent ici et sont
 * obligatoires : le poids et les dimensions. Le choix du véhicule de livraison
 * en dépend entièrement  sans eux, aucune commande contenant la pièce ne peut
 * être chiffrée (SPEC-ALIGNEMENT § 9, point B). Le formulaire l'explique
 * plutôt que de renvoyer une erreur incompréhensible à l'enregistrement.
 *
 * En mode guidé — à la création — il avance étape par étape (cahier des
 * évolutions, § 5.1) : un apprenti qui publie sa première pièce depuis un
 * téléphone voit une question à la fois, pas un formulaire de six panneaux.
 */

interface Category {
  id: string;
  name: string;
  children: Category[];
}

export type SaleState = "AVAILABLE" | "SOLD" | "UNAVAILABLE";

export interface ProductFormValues {
  name: string;
  categoryId: string;
  description: string;
  material: string;
  /** Faux : réalisation de portfolio, montrée dans la galerie sans être vendue. */
  isForSale: boolean;
  availability: SaleState;
  makerPriceXof: string;
  isMadeToOrder: boolean;
  quantityAvailable: string;
  leadTimeDays: string;
  observations: string;
  packagingNotes: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
}

export const EMPTY_PRODUCT: ProductFormValues = {
  name: "",
  categoryId: "",
  description: "",
  material: "",
  isForSale: true,
  availability: "AVAILABLE",
  makerPriceXof: "",
  isMadeToOrder: false,
  quantityAvailable: "1",
  leadTimeDays: "",
  observations: "",
  packagingNotes: "",
  weightGrams: "",
  lengthMm: "",
  widthMm: "",
  heightMm: "",
};

type StepKey = "type" | "piece" | "price" | "availability" | "parcel" | "review";

const STEP_LABELS: Record<StepKey, string> = {
  type: "Type",
  piece: "La pièce",
  price: "Prix",
  availability: "Disponibilité",
  parcel: "Livraison",
  review: "Vérifier",
};

const digits = (value: string) => value.replace(/\D/g, "");

export function ProductForm({
  initial,
  commissionBps,
  submitLabel,
  onSubmit,
  guided = false,
}: {
  initial: ProductFormValues;
  /** Taux appliqué à l'atelier, pour montrer le prix vitrine en direct. */
  commissionBps: number;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  /** Une étape à la fois, avec un récapitulatif avant l'enregistrement. */
  guided?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    void apiFetch<Category[]>("/catalog/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const makerPrice = Number(values.makerPriceXof) || 0;
  /* Le même calcul que le serveur : commission ajoutée au prix de l'atelier,
     jamais retranchée. L'artisan touche son prix en entier. */
  const commission = Math.round((makerPrice * commissionBps) / 10_000);

  /* Une réalisation de portfolio saute le prix, la disponibilité et le colis :
     elle se montre, elle ne se vend pas. */
  const steps: StepKey[] = values.isForSale
    ? ["type", "piece", "price", "availability", "parcel", "review"]
    : ["type", "piece", "review"];
  const current = steps[Math.min(step, steps.length - 1)]!;
  const show = (key: StepKey) => (guided ? current === key : key !== "review");

  const categoryName =
    flatten(categories).find((category) => category.id === values.categoryId)?.label.replace(/^[· ]+/, "") ??
    "—";

  /** Contrôles de l'étape en cours, avant d'avancer. Le serveur revérifie tout. */
  const problemsOf = (key: StepKey): Record<string, string> => {
    const found: Record<string, string> = {};
    if (key === "piece") {
      if (values.name.trim().length < 3) found["name"] = "Donnez un nom d’au moins 3 caractères.";
      if (!values.categoryId) found["categoryId"] = "Choisissez une catégorie.";
      if (values.description.trim().length < 20) {
        found["description"] = "Décrivez la pièce en 20 caractères au moins.";
      }
    }
    if (key === "price" && makerPrice <= 0) found["makerPriceXof"] = "Indiquez votre prix.";
    if (key === "availability" && values.isMadeToOrder && !values.leadTimeDays) {
      found["leadTimeDays"] = "Indiquez le délai de fabrication.";
    }
    if (key === "parcel") {
      for (const field of ["weightGrams", "lengthMm", "widthMm", "heightMm"] as const) {
        if (!Number(values[field])) found[field] = "Nécessaire au calcul de la livraison.";
      }
    }
    return found;
  };

  const next = () => {
    const found = problemsOf(current);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setStep((index) => Math.min(index + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (guided && current !== "review") {
      next();
      return;
    }

    setBusy(true);
    setErrors({});
    setMessage(null);

    const payload: Record<string, unknown> = {
      name: values.name,
      categoryId: values.categoryId,
      description: values.description,
      isForSale: values.isForSale,
    };
    /* Une réalisation de portfolio n'a ni prix ni colis : on n'envoie que ce
       qui la décrit. */
    if (values.isForSale) {
      Object.assign(payload, {
        availability: values.availability,
        makerPriceXof: Number(values.makerPriceXof),
        isMadeToOrder: values.isMadeToOrder,
        quantityAvailable: Number(values.quantityAvailable) || 0,
        weightGrams: Number(values.weightGrams),
        lengthMm: Number(values.lengthMm),
        widthMm: Number(values.widthMm),
        heightMm: Number(values.heightMm),
      });
      if (values.isMadeToOrder && values.leadTimeDays) {
        payload["leadTimeDays"] = Number(values.leadTimeDays);
      }
      if (values.packagingNotes.trim()) payload["packagingNotes"] = values.packagingNotes.trim();
    }
    if (values.material.trim()) payload["material"] = values.material.trim();
    if (values.observations.trim()) payload["observations"] = values.observations.trim();

    try {
      await onSubmit(payload);
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of error.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(
          error.problem.errors?.length
            ? "Quelques champs demandent une correction."
            : error.message,
        );
      } else {
        setMessage("Enregistrement impossible. Réessayez.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={form.form} noValidate>
      {guided ? (
        <ol className={form.steps} aria-label="Étapes de la publication">
          {steps.map((key, index) => (
            <li
              key={key}
              className={
                index === step ? form.stepActive : index < step ? form.stepDone : form.step
              }
              aria-current={index === step ? "step" : undefined}
            >
              <span className={form.stepNumber}>{index + 1}</span>
              <span>{STEP_LABELS[key]}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {show("type") ? (
        <Panel title="Type de publication">
          <div className={form.choices} role="radiogroup" aria-label="Type de publication">
            <label className={values.isForSale ? form.choiceActive : form.choice}>
              <input
                type="radio"
                name="isForSale"
                checked={values.isForSale}
                onChange={() => set("isForSale", true)}
              />
              <span>
                <strong>Pièce à vendre</strong>
                <span className={styles.muted}>Elle apparaît au catalogue et se commande.</span>
              </span>
            </label>
            <label className={!values.isForSale ? form.choiceActive : form.choice}>
              <input
                type="radio"
                name="isForSale"
                checked={!values.isForSale}
                onChange={() => set("isForSale", false)}
              />
              <span>
                <strong>Réalisation de portfolio</strong>
                <span className={styles.muted}>
                  Un projet déjà réalisé, montré sur votre profil sans être vendu. Une photo suffit.
                </span>
              </span>
            </label>
          </div>
        </Panel>
      ) : null}

      {show("piece") ? (
        <Panel title="La pièce">
          <Field
            label="Nom"
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Fauteuil Sènou en rônier"
            error={errors["name"]}
          />

          <Field label="Catégorie" error={errors["categoryId"]}>
            <select
              className={fieldStyles.control}
              value={values.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
            >
              <option value="">Choisir une catégorie</option>
              {flatten(categories).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description" error={errors["description"]}>
            <textarea
              className={fieldStyles.control}
              rows={6}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder="Matériau, finitions, temps de travail, ce qui rend la pièce singulière…"
            />
          </Field>

          <Field
            label="Matériaux (facultatif)"
            value={values.material}
            onChange={(event) => set("material", event.target.value)}
            placeholder="Rônier massif, laiton"
            error={errors["material"]}
          />

          {!values.isForSale ? (
            <Field label="Observations (facultatif)" error={errors["observations"]}>
              <textarea
                className={fieldStyles.control}
                rows={3}
                value={values.observations}
                onChange={(event) => set("observations", event.target.value)}
                placeholder="Client, année, contexte du projet…"
              />
            </Field>
          ) : null}
        </Panel>
      ) : null}

      {values.isForSale && show("price") ? (
        <Panel title="Prix">
          <Field
            label="Votre prix, en francs CFA"
            inputMode="numeric"
            value={values.makerPriceXof}
            onChange={(event) => set("makerPriceXof", digits(event.target.value))}
            error={errors["makerPriceXof"]}
          />

          {/* Le prix affiché en boutique se calcule sous ses yeux : personne ne
              devrait découvrir la commission après la mise en vente (§ 4.6). */}
          <div className={form.priceBreakdown}>
            <div>
              <span>Votre prix</span>
              <strong>{formatFcfa(makerPrice)}</strong>
            </div>
            <div>
              <span>
                Commission Ojà ({formatNumber(commissionBps / 100, commissionBps % 100 ? 2 : 0)} %)
              </span>
              <strong>{formatFcfa(commission)}</strong>
            </div>
            <div className={form.priceTotal}>
              <span>Prix affiché en boutique</span>
              <strong>{formatFcfa(makerPrice + commission)}</strong>
            </div>
            <p className={styles.muted}>
              La commission s’ajoute à votre prix : vous touchez {formatFcfa(makerPrice)} sur
              chaque vente validée. Les frais de livraison sont payés par l’acheteur.
            </p>
          </div>
        </Panel>
      ) : null}

      {values.isForSale && show("availability") ? (
        <Panel title="Disponibilité">
          <Field label="État de vente" error={errors["availability"]}>
            <select
              className={fieldStyles.control}
              value={values.availability}
              onChange={(event) => set("availability", event.target.value as SaleState)}
            >
              <option value="AVAILABLE">Disponible</option>
              <option value="SOLD">Vendue — reste visible dans votre galerie</option>
              <option value="UNAVAILABLE">Momentanément indisponible</option>
            </select>
          </Field>

          <label className={form.check}>
            <input
              type="checkbox"
              checked={values.isMadeToOrder}
              onChange={(event) => set("isMadeToOrder", event.target.checked)}
            />
            <span>Pièce fabriquée sur commande</span>
          </label>

          {values.isMadeToOrder ? (
            <Field
              label="Délai de fabrication, en jours"
              inputMode="numeric"
              value={values.leadTimeDays}
              onChange={(event) => set("leadTimeDays", digits(event.target.value))}
              error={errors["leadTimeDays"]}
            />
          ) : (
            <Field
              label="Quantité disponible"
              inputMode="numeric"
              value={values.quantityAvailable}
              onChange={(event) => set("quantityAvailable", digits(event.target.value))}
              error={errors["quantityAvailable"]}
            />
          )}

          <Field label="Observations (facultatif)" error={errors["observations"]}>
            <textarea
              className={fieldStyles.control}
              rows={3}
              value={values.observations}
              onChange={(event) => set("observations", event.target.value)}
              placeholder="Précautions de manipulation, variations de teinte…"
            />
          </Field>
        </Panel>
      ) : null}

      {values.isForSale && show("parcel") ? (
        <Panel title="Poids, dimensions et livraison">
          <p className={styles.muted}>
            Ces mesures servent à choisir le véhicule et à calculer les frais de livraison. Sans
            elles, la pièce ne peut pas être commandée. Mesurez l’encombrement emballé.
          </p>

          <Field
            label="Poids, en grammes"
            inputMode="numeric"
            value={values.weightGrams}
            onChange={(event) => set("weightGrams", digits(event.target.value))}
            error={errors["weightGrams"]}
          />

          <FieldRow>
            <Field
              label="Longueur (mm)"
              inputMode="numeric"
              value={values.lengthMm}
              onChange={(event) => set("lengthMm", digits(event.target.value))}
              error={errors["lengthMm"]}
            />
            <Field
              label="Largeur (mm)"
              inputMode="numeric"
              value={values.widthMm}
              onChange={(event) => set("widthMm", digits(event.target.value))}
              error={errors["widthMm"]}
            />
          </FieldRow>

          <Field
            label="Hauteur (mm)"
            inputMode="numeric"
            value={values.heightMm}
            onChange={(event) => set("heightMm", digits(event.target.value))}
            error={errors["heightMm"]}
          />

          <Field label="Emballage et transport (facultatif)" error={errors["packagingNotes"]}>
            <textarea
              className={fieldStyles.control}
              rows={3}
              value={values.packagingNotes}
              onChange={(event) => set("packagingNotes", event.target.value)}
              placeholder="Fragile, à transporter debout, livrée démontée, protégée par une housse…"
            />
          </Field>
        </Panel>
      ) : null}

      {guided && current === "review" ? (
        <Panel title="Vérifier avant d’enregistrer">
          <dl className={form.summary}>
            <div>
              <dt>Type</dt>
              <dd>{values.isForSale ? "Pièce à vendre" : "Réalisation de portfolio"}</dd>
            </div>
            <div>
              <dt>Nom</dt>
              <dd>{values.name}</dd>
            </div>
            <div>
              <dt>Catégorie</dt>
              <dd>{categoryName}</dd>
            </div>
            {values.isForSale ? (
              <>
                <div>
                  <dt>Prix affiché</dt>
                  <dd>{formatFcfa(makerPrice + commission)}</dd>
                </div>
                <div>
                  <dt>Disponibilité</dt>
                  <dd>
                    {values.isMadeToOrder
                      ? `Sur commande, ${values.leadTimeDays} jours`
                      : `${values.quantityAvailable || 0} en stock`}
                  </dd>
                </div>
                <div>
                  <dt>Colis</dt>
                  <dd>
                    {formatNumber((Number(values.weightGrams) || 0) / 1000, 1)} kg ·{" "}
                    {values.lengthMm} × {values.widthMm} × {values.heightMm} mm
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className={styles.muted}>
            Rien n’est publié à cette étape. Vous ajouterez ensuite les photos, puis enverrez la
            fiche en validation.
          </p>
        </Panel>
      ) : null}

      {message ? <p className={styles.error}>{message}</p> : null}

      <div className={form.actions}>
        {guided && step > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setErrors({});
              setStep((index) => Math.max(0, index - 1));
            }}
          >
            Précédent
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy
            ? "Enregistrement…"
            : guided && current !== "review"
              ? "Suivant"
              : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Les catégories sont un arbre ; un `select` demande une liste à plat. */
function flatten(
  categories: Category[],
  depth = 0,
): { id: string; label: string }[] {
  return categories.flatMap((category) => [
    { id: category.id, label: `${"· ".repeat(depth)}${category.name}` },
    ...flatten(category.children ?? [], depth + 1),
  ]);
}
