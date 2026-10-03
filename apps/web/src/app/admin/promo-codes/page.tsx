"use client";

import type { AdminPromoCode } from "@oja/contracts";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, fieldStyles } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa, formatNumber } from "@/lib/format";

/**
 * Codes promo (cahier L2-11 / L7).
 *
 * La remise sort toujours de la commission Ojà : l'API la borne à la
 * commission de chaque commande, quoi qu'on saisisse ici. On peut créer,
 * suivre le compteur d'utilisations, et désactiver.
 */
export default function PromoCodesPage() {
  const [codes, setCodes] = useState<AdminPromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setCodes(await apiFetch<AdminPromoCode[]>("/admin/promo-codes"));
    } catch {
      setError("Chargement impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const numeric = Number(value);
      await apiFetch("/admin/promo-codes", {
        method: "POST",
        body: {
          code: code.trim().toUpperCase(),
          kind,
          ...(kind === "PERCENT"
            ? { valueBps: Math.round(numeric * 100) }
            : { amountXof: Math.round(numeric) }),
          ...(minOrder ? { minOrderXof: Math.round(Number(minOrder)) } : {}),
          ...(maxRedemptions ? { maxRedemptions: Math.round(Number(maxRedemptions)) } : {}),
        },
      });
      setCode("");
      setValue("");
      setMinOrder("");
      setMaxRedemptions("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Création refusée.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (promo: AdminPromoCode) => {
    try {
      await apiFetch(`/admin/promo-codes/${promo.id}`, {
        method: "PATCH",
        body: { isActive: !promo.isActive },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Mise à jour refusée.");
    }
  };

  return (
    <>
      <PageHead
        title="Codes promo"
        subtitle="La remise est toujours plafonnée à la commission Ojà : le créateur et le livreur restent payés en entier."
      />

      <Panel title="Nouveau code">
        <form onSubmit={create} className={styles.form}>
          <Field label="Code">
            <input
              className={fieldStyles.control}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BIENVENUE"
              required
            />
          </Field>
          <Field label="Type">
            <select
              className={fieldStyles.control}
              value={kind}
              onChange={(e) => setKind(e.target.value as "PERCENT" | "FIXED")}
            >
              <option value="PERCENT">Pourcentage</option>
              <option value="FIXED">Montant fixe (F CFA)</option>
            </select>
          </Field>
          <Field label={kind === "PERCENT" ? "Remise (%)" : "Remise (F CFA)"}>
            <input
              className={fieldStyles.control}
              type="number"
              min="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </Field>
          {/* Une remise ne dépasse jamais la commission Ojà de la commande : au-delà,
              le code paraît « ne pas marcher ». On le dit avant de le créer. */}
          {kind === "PERCENT" && Number(value) > 5 ? (
            <p className={styles.error} role="status">
              Attention : la remise réelle sera ramenée à la commission Ojà de la
              commande, soit environ 5 % du prix des pièces. Un code à {value} % donnera en
              pratique autour de 5 %.
            </p>
          ) : kind === "FIXED" && Number(value) > 0 ? (
            <p className={styles.muted}>
              La remise réelle ne dépassera pas la commission Ojà de la commande (environ 5 %
              du prix des pièces) : elle n&apos;atteint {formatFcfa(Number(value))} qu&apos;à
              partir d&apos;environ {formatFcfa(Number(value) * 20)} de pièces.
            </p>
          ) : null}
          <Field label="Montant minimum de commande (F CFA, facultatif)">
            <input
              className={fieldStyles.control}
              type="number"
              min="0"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
            />
          </Field>
          <Field label="Nombre d'utilisations maximum (facultatif)">
            <input
              className={fieldStyles.control}
              type="number"
              min="1"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
            />
          </Field>
          {error ? <p className={styles.error}>{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Création…" : "Créer le code"}
          </Button>
        </form>
      </Panel>

      <Panel title="Codes existants">
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : codes.length === 0 ? (
          <EmptyState title="Aucun code" text="Créez-en un ci-dessus." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Remise</th>
                  <th>Min.</th>
                  <th>Utilisations</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {codes.map((promo) => (
                  <tr key={promo.id}>
                    <td>
                      <strong>{promo.code}</strong>
                    </td>
                    <td>
                      {promo.kind === "PERCENT"
                        ? `${formatNumber((promo.valueBps ?? 0) / 100, (promo.valueBps ?? 0) % 100 ? 2 : 0)} %`
                        : formatFcfa(promo.amountXof ?? 0)}
                    </td>
                    <td>{promo.minOrderXof > 0 ? formatFcfa(promo.minOrderXof) : "Aucun"}</td>
                    <td>
                      {promo.redemptionCount}
                      {promo.maxRedemptions ? ` / ${promo.maxRedemptions}` : ""}
                    </td>
                    <td>
                      <Badge type={promo.isActive ? "success" : "pending"}>
                        {promo.isActive ? "Actif" : "Désactivé"}
                      </Badge>
                    </td>
                    <td className={styles.rowActions}>
                      <Button variant="outline" onClick={() => void toggle(promo)}>
                        {promo.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
