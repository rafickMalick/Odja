"use client";

import type { VisibilityPlanView } from "@oja/contracts";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { useToast } from "@/components/Toast";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Formules de visibilité (cahier des évolutions, § 3.3 et § 11.2).
 *
 * Tout ce qui distingue Standard et Premium se règle ici, sans toucher au
 * code : quota de fiches, durée, prix, avantages affichés, badge, place dans
 * l'annuaire. Chaque modification est journalisée.
 */

interface Draft {
  name: string;
  description: string;
  maxPublications: string;
  durationDays: string;
  priceXof: string;
  perks: string;
  showBadge: boolean;
  boostInDirectory: boolean;
  isActive: boolean;
  position: string;
}

function toDraft(plan: VisibilityPlanView): Draft {
  return {
    name: plan.name,
    description: plan.description ?? "",
    maxPublications: plan.maxPublications === null ? "" : String(plan.maxPublications),
    durationDays: plan.durationDays === null ? "" : String(plan.durationDays),
    priceXof: String(plan.priceXof),
    perks: plan.perks.join("\n"),
    showBadge: plan.showBadge,
    boostInDirectory: plan.boostInDirectory,
    isActive: plan.isActive,
    position: String(plan.position),
  };
}

const EMPTY: Draft = {
  name: "",
  description: "",
  maxPublications: "",
  durationDays: "30",
  priceXof: "0",
  perks: "",
  showBadge: true,
  boostInDirectory: true,
  isActive: true,
  position: "5",
};

function toPayload(draft: Draft) {
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    maxPublications: draft.maxPublications ? Number(draft.maxPublications) : null,
    durationDays: draft.durationDays ? Number(draft.durationDays) : null,
    priceXof: Number(draft.priceXof) || 0,
    perks: draft.perks
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    showBadge: draft.showBadge,
    boostInDirectory: draft.boostInDirectory,
    isActive: draft.isActive,
    position: Number(draft.position) || 0,
  };
}

export default function PlansPage() {
  const [plans, setPlans] = useState<VisibilityPlanView[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setPlans(await apiFetch<VisibilityPlanView[]>("/admin/visibility-plans").catch(() => []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="Formules de visibilité"
        subtitle="Quotas, durée, prix et avantages de chaque formule. Une formule achète de la visibilité, jamais une certification."
        action={
          <Button type="button" variant="outline" onClick={() => setCreating((value) => !value)}>
            {creating ? "Annuler" : "Nouvelle formule"}
          </Button>
        }
      />

      {creating ? (
        <PlanEditor
          title="Nouvelle formule"
          initial={EMPTY}
          withCode
          onSave={async (draft, code) => {
            await apiFetch("/admin/visibility-plans", {
              method: "POST",
              body: { code, ...toPayload(draft) },
            });
            setCreating(false);
            await load();
          }}
        />
      ) : null}

      {plans === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : (
        plans.map((plan) => (
          <PlanEditor
            key={`${plan.id}-${plan.name}-${plan.priceXof}`}
            title={plan.name}
            badge={
              plan.isDefault ? (
                <Badge type="info">Par défaut</Badge>
              ) : plan.isActive ? (
                <Badge type="success">Active</Badge>
              ) : (
                <Badge type="pending">Désactivée</Badge>
              )
            }
            initial={toDraft(plan)}
            isDefault={plan.isDefault}
            onSave={async (draft) => {
              await apiFetch(`/admin/visibility-plans/${plan.id}`, {
                method: "PATCH",
                body: toPayload(draft),
              });
              await load();
            }}
          />
        ))
      )}
    </>
  );
}

function PlanEditor({
  title,
  badge,
  initial,
  isDefault = false,
  withCode = false,
  onSave,
}: {
  title: string;
  badge?: React.ReactNode;
  initial: Draft;
  isDefault?: boolean;
  withCode?: boolean;
  onSave: (draft: Draft, code: string) => Promise<void>;
}) {
  const { notify } = useToast();
  const [draft, setDraft] = useState(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const digits = (value: string) => value.replace(/\D/g, "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await onSave(draft, code.trim());
      notify("Formule enregistrée.", { tone: "success" });
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of error.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(error.message);
      } else {
        setMessage("Enregistrement impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={title} action={badge}>
      <form onSubmit={save} className={admin.planForm} noValidate>
        <FieldRow>
          {withCode ? (
            <Field
              label="Code (définitif)"
              value={code}
              onChange={(event) => setCode(event.target.value.toLowerCase())}
              placeholder="vip"
              error={errors["code"]}
            />
          ) : null}
          <Field
            label="Nom affiché"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            error={errors["name"]}
          />
        </FieldRow>

        <Field
          label="Description (facultatif)"
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
          error={errors["description"]}
        />

        <FieldRow>
          <Field
            label="Fiches actives (vide = illimité)"
            inputMode="numeric"
            value={draft.maxPublications}
            onChange={(event) => set("maxPublications", digits(event.target.value))}
            error={errors["maxPublications"]}
          />
          <Field
            label={isDefault ? "Durée (sans échéance)" : "Durée, en jours"}
            inputMode="numeric"
            value={draft.durationDays}
            onChange={(event) => set("durationDays", digits(event.target.value))}
            disabled={isDefault}
            error={errors["durationDays"]}
          />
          <Field
            label="Prix (F CFA)"
            inputMode="numeric"
            value={draft.priceXof}
            onChange={(event) => set("priceXof", digits(event.target.value))}
            error={errors["priceXof"]}
          />
        </FieldRow>

        <Field label="Avantages affichés au créateur (un par ligne)" error={errors["perks"]}>
          <textarea
            className={fieldStyles.control}
            rows={4}
            value={draft.perks}
            onChange={(event) => set("perks", event.target.value)}
          />
        </Field>

        <div className={admin.checks}>
          <label>
            <input
              type="checkbox"
              checked={draft.showBadge}
              onChange={(event) => set("showBadge", event.target.checked)}
            />
            Badge sur le profil public
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.boostInDirectory}
              onChange={(event) => set("boostInDirectory", event.target.checked)}
            />
            En tête de l’annuaire des créateurs
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.isActive}
              disabled={isDefault}
              onChange={(event) => set("isActive", event.target.checked)}
            />
            Proposée aux créateurs
          </label>
          <label className={admin.position}>
            Ordre d’affichage
            <input
              className={fieldStyles.control}
              inputMode="numeric"
              value={draft.position}
              onChange={(event) => set("position", digits(event.target.value))}
            />
          </label>
        </div>

        {message ? <p className={styles.error}>{message}</p> : null}

        <div className={styles.rowActions}>
          <Button type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
