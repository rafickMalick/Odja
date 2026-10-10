"use client";

import type { ExhibitionPlanView, OrganizerExhibition } from "@oja/contracts";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import editor from "./editor.module.css";

/**
 * Dossier d'exposition (§ 6.3) : informations générales, calendrier, format
 * et lieu, formule, accès. Les œuvres et les fichiers viennent après le
 * premier enregistrement, quand le dossier a un identifiant.
 */

interface City {
  id: string;
  name: string;
}

type Values = Record<string, string | boolean>;

function toValues(exhibition: OrganizerExhibition | null): Values {
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : "");
  return {
    title: exhibition?.title ?? "",
    organizerName: exhibition?.organizerName ?? "",
    summary: exhibition?.summary ?? "",
    objective: exhibition?.objective ?? "",
    discipline: exhibition?.discipline ?? "",
    cityId: exhibition?.cityId ?? "",
    startsAt: day(exhibition?.startsAt),
    endsAt: day(exhibition?.endsAt),
    openingHours: exhibition?.openingHours ?? "",
    format: exhibition?.format ?? "ONLINE",
    venueName: exhibition?.venueName ?? "",
    venueAddress: exhibition?.venueAddress ?? "",
    venueDescription: exhibition?.venueDescription ?? "",
    plannedWorkCount: exhibition?.plannedWorkCount ? String(exhibition.plannedWorkCount) : "",
    planId: exhibition?.plan?.id ?? "",
    accessMode: exhibition?.accessMode ?? "FREE",
    ticketPriceXof: exhibition?.ticketPriceXof ? String(exhibition.ticketPriceXof) : "",
    requiresRegistration: exhibition?.requiresRegistration ?? false,
    accessCode: "",
    onsiteInfo: exhibition?.onsiteInfo ?? "",
    remoteInfo: exhibition?.remoteInfo ?? "",
  };
}

export function ExhibitionForm({
  exhibition,
  disabled = false,
  submitLabel,
  onSaved,
}: {
  exhibition: OrganizerExhibition | null;
  disabled?: boolean;
  submitLabel: string;
  onSaved: (saved: OrganizerExhibition) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Values>(() => toValues(exhibition));
  const [cities, setCities] = useState<City[]>([]);
  const [plans, setPlans] = useState<ExhibitionPlanView[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch<City[]>("/geo/cities").then(setCities).catch(() => setCities([]));
    void apiFetch<ExhibitionPlanView[]>("/exhibitions/plans").then(setPlans).catch(() => setPlans([]));
  }, []);

  const set = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));
  const text = (key: string) => String(values[key] ?? "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    /* Les dates du formulaire sont des jours : l'exposition commence à
       l'ouverture et finit à la fermeture du dernier jour. */
    const payload: Record<string, unknown> = {
      title: text("title"),
      organizerName: text("organizerName"),
      summary: text("summary"),
      cityId: text("cityId"),
      startsAt: text("startsAt") ? new Date(`${text("startsAt")}T08:00:00`).toISOString() : undefined,
      endsAt: text("endsAt") ? new Date(`${text("endsAt")}T20:00:00`).toISOString() : undefined,
      format: text("format"),
      accessMode: text("accessMode"),
      ticketPriceXof: text("accessMode") === "PAID" ? Number(text("ticketPriceXof")) || 0 : 0,
      requiresRegistration: Boolean(values["requiresRegistration"]),
    };
    for (const key of [
      "objective",
      "discipline",
      "openingHours",
      "venueName",
      "venueAddress",
      "venueDescription",
      "planId",
      "accessCode",
      "onsiteInfo",
      "remoteInfo",
    ]) {
      if (text(key).trim()) payload[key] = text(key).trim();
    }
    if (text("plannedWorkCount")) payload["plannedWorkCount"] = Number(text("plannedWorkCount"));

    try {
      const saved = exhibition
        ? await apiFetch<OrganizerExhibition>(`/my/exhibitions/${exhibition.id}`, {
            method: "PATCH",
            body: payload,
          })
        : await apiFetch<OrganizerExhibition>("/my/exhibitions", { method: "POST", body: payload });
      set("accessCode", "");
      setMessage("Dossier enregistré.");
      await onSaved(saved);
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of cause.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(cause.problem.errors?.length ? "Quelques champs demandent une correction." : cause.message);
      } else {
        setMessage("Enregistrement impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onsite = text("format") !== "ONLINE";

  return (
    <form onSubmit={save} className={editor.form} noValidate>
      <fieldset disabled={disabled} className={editor.fieldset}>
        <Panel title="Informations générales">
          <Field label="Nom de l’exposition" value={text("title")} onChange={(e) => set("title", e.target.value)} error={errors["title"]} />
          <FieldRow>
            <Field
              label="Organisateur"
              value={text("organizerName")}
              onChange={(e) => set("organizerName", e.target.value)}
              placeholder="Vous, votre atelier, votre galerie…"
              error={errors["organizerName"]}
            />
            <Field
              label="Discipline (facultatif)"
              value={text("discipline")}
              onChange={(e) => set("discipline", e.target.value)}
              placeholder="Céramique, photographie, design…"
              error={errors["discipline"]}
            />
          </FieldRow>
          <Field label="Présentation du projet" error={errors["summary"]}>
            <textarea
              className={fieldStyles.control}
              rows={6}
              value={text("summary")}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="Le propos, les artistes, ce que le visiteur va découvrir…"
            />
          </Field>
          <Field label="Objectif (facultatif)" error={errors["objective"]}>
            <textarea
              className={fieldStyles.control}
              rows={3}
              value={text("objective")}
              onChange={(e) => set("objective", e.target.value)}
            />
          </Field>
        </Panel>

        <Panel title="Calendrier">
          <FieldRow>
            <Field label="Début" type="date" value={text("startsAt")} onChange={(e) => set("startsAt", e.target.value)} error={errors["startsAt"]} />
            <Field label="Fin" type="date" value={text("endsAt")} onChange={(e) => set("endsAt", e.target.value)} error={errors["endsAt"]} />
          </FieldRow>
          <Field
            label="Horaires d’ouverture (facultatif)"
            value={text("openingHours")}
            onChange={(e) => set("openingHours", e.target.value)}
            placeholder="Du mardi au samedi, 10 h – 18 h"
            error={errors["openingHours"]}
          />
        </Panel>

        <Panel title="Format et lieu">
          <FieldRow>
            <Field label="Format" error={errors["format"]}>
              <select className={fieldStyles.control} value={text("format")} onChange={(e) => set("format", e.target.value)}>
                <option value="ONLINE">En ligne uniquement</option>
                <option value="PHYSICAL">Sur place uniquement</option>
                <option value="HYBRID">Sur place et en ligne</option>
              </select>
            </Field>
            <Field label="Ville" error={errors["cityId"]}>
              <select className={fieldStyles.control} value={text("cityId")} onChange={(e) => set("cityId", e.target.value)}>
                <option value="">Choisir une ville</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRow>
          {onsite ? (
            <>
              <FieldRow>
                <Field label="Nom du lieu" value={text("venueName")} onChange={(e) => set("venueName", e.target.value)} error={errors["venueName"]} />
                <Field label="Adresse" value={text("venueAddress")} onChange={(e) => set("venueAddress", e.target.value)} error={errors["venueAddress"]} />
              </FieldRow>
              <Field label="Présentation du lieu (facultatif)" error={errors["venueDescription"]}>
                <textarea
                  className={fieldStyles.control}
                  rows={3}
                  value={text("venueDescription")}
                  onChange={(e) => set("venueDescription", e.target.value)}
                />
              </Field>
            </>
          ) : null}
          <Field
            label="Nombre d’œuvres envisagé (facultatif)"
            inputMode="numeric"
            value={text("plannedWorkCount")}
            onChange={(e) => set("plannedWorkCount", e.target.value.replace(/\D/g, ""))}
          />
        </Panel>

        <Panel title="Formule">
          <div className={editor.plans}>
            {plans.map((plan) => (
              <label key={plan.id} className={text("planId") === plan.id ? editor.planActive : editor.plan}>
                <input type="radio" name="planId" checked={text("planId") === plan.id} onChange={() => set("planId", plan.id)} />
                <span>
                  <strong>{plan.name}</strong>
                  <span className={styles.muted}>
                    {plan.priceXof > 0 ? formatFcfa(plan.priceXof) : "Tarif sur demande"}
                    {plan.maxWorks ? ` · ${plan.maxWorks} œuvres` : " · œuvres illimitées"}
                    {plan.maxDurationDays ? ` · ${plan.maxDurationDays} jours` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Accès des visiteurs">
          <Field label="Accès" error={errors["accessMode"]}>
            <select className={fieldStyles.control} value={text("accessMode")} onChange={(e) => set("accessMode", e.target.value)}>
              <option value="FREE">Gratuit</option>
              <option value="PAID">Payant (billet)</option>
              <option value="RESTRICTED">Réservé aux personnes invitées (code)</option>
            </select>
          </Field>
          {text("accessMode") === "FREE" ? (
            <label className={editor.check}>
              <input
                type="checkbox"
                checked={Boolean(values["requiresRegistration"])}
                onChange={(e) => set("requiresRegistration", e.target.checked)}
              />
              Demander une inscription gratuite, pour connaître le nombre de visiteurs
            </label>
          ) : null}
          {text("accessMode") === "PAID" ? (
            <Field
              label="Prix du billet (F CFA)"
              inputMode="numeric"
              value={text("ticketPriceXof")}
              onChange={(e) => set("ticketPriceXof", e.target.value.replace(/\D/g, ""))}
              error={errors["ticketPriceXof"]}
            />
          ) : null}
          {text("accessMode") === "RESTRICTED" ? (
            <Field
              label={exhibition?.hasAccessCode ? "Nouveau code d’accès (laisser vide pour garder l’actuel)" : "Code d’accès"}
              value={text("accessCode")}
              onChange={(e) => set("accessCode", e.target.value)}
              error={errors["accessCode"]}
            />
          ) : null}
          {onsite ? (
            <Field label="Informations pour les visiteurs sur place (facultatif)" error={errors["onsiteInfo"]}>
              <textarea className={fieldStyles.control} rows={2} value={text("onsiteInfo")} onChange={(e) => set("onsiteInfo", e.target.value)} />
            </Field>
          ) : null}
          {text("format") !== "PHYSICAL" ? (
            <Field label="Informations pour les visiteurs à distance (facultatif)" error={errors["remoteInfo"]}>
              <textarea className={fieldStyles.control} rows={2} value={text("remoteInfo")} onChange={(e) => set("remoteInfo", e.target.value)} />
            </Field>
          ) : null}
        </Panel>

        {message ? <p className={styles.muted}>{message}</p> : null}

        <div className={editor.actions}>
          <Button type="submit" disabled={busy || disabled}>
            {busy ? "Enregistrement…" : submitLabel}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
