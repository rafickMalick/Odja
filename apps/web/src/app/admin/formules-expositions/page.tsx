"use client";

import type { ExhibitionPlanView } from "@oja/contracts";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { useToast } from "@/components/Toast";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Formules d'exposition — Standard, Premium, VIP (§ 6.6). Nombre d'œuvres,
 * durée, prix, avantages, mise en avant et accompagnement se règlent ici,
 * sans toucher au code. Chaque modification est journalisée.
 */

interface Draft {
  name: string;
  description: string;
  maxWorks: string;
  maxDurationDays: string;
  priceXof: string;
  perks: string;
  featuredPlacement: boolean;
  communicationSupport: boolean;
  isActive: boolean;
  position: string;
}

const EMPTY: Draft = {
  name: "",
  description: "",
  maxWorks: "",
  maxDurationDays: "",
  priceXof: "0",
  perks: "",
  featuredPlacement: false,
  communicationSupport: false,
  isActive: true,
  position: "5",
};

function toDraft(plan: ExhibitionPlanView): Draft {
  return {
    name: plan.name,
    description: plan.description ?? "",
    maxWorks: plan.maxWorks === null ? "" : String(plan.maxWorks),
    maxDurationDays: plan.maxDurationDays === null ? "" : String(plan.maxDurationDays),
    priceXof: String(plan.priceXof),
    perks: plan.perks.join("\n"),
    featuredPlacement: plan.featuredPlacement,
    communicationSupport: plan.communicationSupport,
    isActive: plan.isActive,
    position: String(plan.position),
  };
}

function toPayload(draft: Draft) {
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    maxWorks: draft.maxWorks ? Number(draft.maxWorks) : null,
    maxDurationDays: draft.maxDurationDays ? Number(draft.maxDurationDays) : null,
    priceXof: Number(draft.priceXof) || 0,
    perks: draft.perks
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    featuredPlacement: draft.featuredPlacement,
    communicationSupport: draft.communicationSupport,
    isActive: draft.isActive,
    position: Number(draft.position) || 0,
  };
}

export default function ExhibitionPlansPage() {
  const [plans, setPlans] = useState<ExhibitionPlanView[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setPlans(await apiFetch<ExhibitionPlanView[]>("/admin/exhibitions/plans").catch(() => []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="Formules d’exposition"
        subtitle="Œuvres, durée, prix et accompagnement de chaque formule proposée aux organisateurs."
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
            await apiFetch("/admin/exhibitions/plans", { method: "POST", body: { code, ...toPayload(draft) } });
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
            badge={<Badge type={plan.isActive ? "success" : "pending"}>{plan.isActive ? "Proposée" : "Retirée"}</Badge>}
            initial={toDraft(plan)}
            onSave={async (draft) => {
              await apiFetch(`/admin/exhibitions/plans/${plan.id}`, { method: "PATCH", body: toPayload(draft) });
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
  withCode = false,
  onSave,
}: {
  title: string;
  badge?: React.ReactNode;
  initial: Draft;
  withCode?: boolean;
  onSave: (draft: Draft, code: string) => Promise<void>;
}) {
  const { notify } = useToast();
  const [draft, setDraft] = useState(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const digits = (value: string) => value.replace(/\D/g, "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await onSave(draft, code.trim());
      notify("Formule enregistrée.", { tone: "success" });
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={title} action={badge}>
      <form onSubmit={save} className={admin.planForm} noValidate>
        <FieldRow>
          {withCode ? (
            <Field label="Code (définitif)" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="vip" />
          ) : null}
          <Field label="Nom affiché" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </FieldRow>
        <Field label="Description (facultatif)" value={draft.description} onChange={(e) => set("description", e.target.value)} />
        <FieldRow>
          <Field label="Œuvres au plus (vide = illimité)" inputMode="numeric" value={draft.maxWorks} onChange={(e) => set("maxWorks", digits(e.target.value))} />
          <Field label="Durée maximale, en jours (vide = illimitée)" inputMode="numeric" value={draft.maxDurationDays} onChange={(e) => set("maxDurationDays", digits(e.target.value))} />
          <Field label="Prix (F CFA)" inputMode="numeric" value={draft.priceXof} onChange={(e) => set("priceXof", digits(e.target.value))} />
        </FieldRow>
        <Field label="Avantages affichés (un par ligne)">
          <textarea className={fieldStyles.control} rows={4} value={draft.perks} onChange={(e) => set("perks", e.target.value)} />
        </Field>
        <div className={admin.checks}>
          <label>
            <input type="checkbox" checked={draft.featuredPlacement} onChange={(e) => set("featuredPlacement", e.target.checked)} />
            Mise en avant dans la rubrique Expositions
          </label>
          <label>
            <input type="checkbox" checked={draft.communicationSupport} onChange={(e) => set("communicationSupport", e.target.checked)} />
            Communication et accompagnement par Ojà
          </label>
          <label>
            <input type="checkbox" checked={draft.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            Proposée aux organisateurs
          </label>
          <label className={admin.position}>
            Ordre
            <input className={fieldStyles.control} inputMode="numeric" value={draft.position} onChange={(e) => set("position", digits(e.target.value))} />
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
