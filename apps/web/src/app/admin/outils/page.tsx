"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Outils d'exploitation.
 *
 * Deux choses provisoires y cohabitent, et le disent :
 *
 *   · les **tâches périodiques**, que l'ordonnanceur exécute aussi : les
 *     lancer ici évite d'attendre son prochain passage. Elles sont
 *     idempotentes, les relancer deux fois ne double rien ;
 *   · le **paiement simulé**, qui permet de dérouler un parcours complet avant
 *     que l'agrégateur ne soit branché. L'API le refuse en production.
 */

const JOBS: { path: string; label: string; description: string }[] = [
  {
    path: "/admin/jobs/auto-validate",
    label: "Valider les livraisons sans réponse",
    description:
      "Passe en validées les sous-commandes livrées depuis plus de 72 h sans retour du client.",
  },
  {
    path: "/admin/jobs/release-payouts",
    label: "Libérer les versements échus",
    description: "Rend exécutables les versements dont l’échéance de 24 h est passée.",
  },
  {
    path: "/admin/orders/expire-unanswered",
    label: "Refuser les commandes sans réponse",
    description:
      "Annule les sous-commandes qu’un créateur n’a pas acceptées dans les 48 h, et rembourse le client.",
  },
  {
    path: "/admin/payments/expire-stale",
    label: "Expirer les paiements abandonnés",
    description: "Libère le stock réservé par des paiements jamais confirmés.",
  },
];

export default function AdminToolsPage() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [orderReference, setOrderReference] = useState("");

  const run = async (path: string, label: string) => {
    setBusy(path);
    try {
      const result = await apiFetch<Record<string, unknown>>(path, { method: "POST" });
      setLog((current) => [
        `${new Date().toLocaleTimeString("fr-FR")} · ${label} : ${describe(result)}`,
        ...current,
      ]);
    } catch (cause) {
      setLog((current) => [
        `${new Date().toLocaleTimeString("fr-FR")} · ${label} : échec, ${
          cause instanceof ApiError ? cause.message : "erreur"
        }`,
        ...current,
      ]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title="Outils"
        subtitle="Les tâches de l’ordonnanceur, à lancer à la main sans attendre son prochain passage."
      />

      <Panel title="Tâches périodiques">
        <p className={styles.muted}>
          Toutes sont idempotentes : les relancer ne produit pas d’effet en double.
        </p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tâche</th>
                <th>Effet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {JOBS.map((job) => (
                <tr key={job.path}>
                  <td>{job.label}</td>
                  <td className={styles.muted}>{job.description}</td>
                  <td className={styles.rowActions}>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void run(job.path, job.label)}
                      disabled={busy === job.path}
                    >
                      {busy === job.path ? "…" : "Exécuter"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Paiement simulé">
        <p className={styles.muted}>
          Marque une commande comme payée sans passer par l’agrégateur. Refusé en production.
        </p>

        <Field
          label="Référence de commande"
          value={orderReference}
          onChange={(event) => setOrderReference(event.target.value.toUpperCase())}
          placeholder="CMD-2026-000123"
        />

        <div className={styles.rowActions}>
          <Button
            type="button"
            disabled={!orderReference.trim() || busy !== null}
            onClick={() =>
              void run(
                `/admin/payments/simulate/${orderReference.trim()}`,
                `Paiement simulé ${orderReference.trim()}`,
              )
            }
          >
            Simuler le paiement
          </Button>
        </div>
      </Panel>

      {log.length > 0 ? (
        <Panel title="Journal de session">
          <ul className={admin.documents}>
            {log.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

/* Le journal est lu par un agent, pas par un développeur : on traduit la
   réponse de l'API (« {"status":"PAID"} ») en phrase. */
const RESULT_LABELS: Record<string, (value: number) => string> = {
  validated: (n) => `${n} livraison${n > 1 ? "s" : ""} validée${n > 1 ? "s" : ""}`,
  released: (n) => `${n} versement${n > 1 ? "s" : ""} libéré${n > 1 ? "s" : ""}`,
  rejected: (n) => `${n} commande${n > 1 ? "s" : ""} refusée${n > 1 ? "s" : ""}`,
  expired: (n) => `${n} paiement${n > 1 ? "s" : ""} expiré${n > 1 ? "s" : ""}`,
  reminded: (n) => `${n} relance${n > 1 ? "s" : ""} envoyée${n > 1 ? "s" : ""}`,
};

const STATUS_LABELS: Record<string, string> = {
  PAID: "commande payée",
  PENDING: "paiement toujours en attente",
  FAILED: "paiement refusé",
};

function describe(result: Record<string, unknown> | null | undefined): string {
  if (!result) return "terminé";
  const parts = Object.entries(result).map(([key, value]) => {
    if (key === "status" && typeof value === "string") {
      return STATUS_LABELS[value] ?? `statut ${value.toLowerCase()}`;
    }
    if (typeof value === "number" && RESULT_LABELS[key]) return RESULT_LABELS[key](value);
    return `${key} : ${String(value)}`;
  });
  return parts.length > 0 ? parts.join(", ") : "terminé";
}
