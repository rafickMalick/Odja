"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";

/**
 * Journal d'audit.
 *
 * Il répond à une seule question, mais celle qui compte quand un dossier
 * tourne mal : **qui a décidé quoi, et quand**. C'est aussi la pièce qu'on
 * produit à un artisan qui conteste un refus, ou à un régulateur.
 */

interface Entry {
  id: string;
  action: string;
  actorRole: string | null;
  actorName: string | null;
  targetType: string;
  targetId: string;
  createdAt: string;
}

/** Actions traduites. Une action inconnue s'affiche telle quelle plutôt que
 *  d'être masquée : mieux vaut un libellé technique qu'une ligne absente. */
const ACTIONS: Record<string, string> = {
  "maker.approve": "Atelier validé",
  "maker.reject": "Atelier refusé",
  "courier.approve": "Livreur validé",
  "courier.reject": "Livreur refusé",
  "product.publish": "Fiche publiée",
  "product.reject": "Fiche refusée",
  "product.hide": "Fiche masquée",
  "product.unhide": "Fiche réaffichée",
  "shipment.assign": "Livreur affecté",
  "dispute.resolve": "Réclamation tranchée",
  "country.open": "Pays ouvert",
  "country.close": "Pays fermé",
};

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [action, setAction] = useState("");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (action.trim()) params.set("action", action.trim());
    if (targetId.trim()) params.set("targetId", targetId.trim());

    setEntries(
      await apiFetch<Entry[]>(`/admin/audit${params.size ? `?${params}` : ""}`).catch(() => []),
    );
    setLoading(false);
  }, [action, targetId]);

  useEffect(() => {
    void load();
    // Le chargement initial seulement : ensuite, la recherche est explicite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead
        title="Journal d’audit"
        subtitle="Qui a décidé quoi, et quand. Conservé même après suppression du compte concerné."
      />

      <Panel title="Rechercher">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <Field
            label="Action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="maker.reject, product.publish…"
          />
          <Field
            label="Identifiant de l’objet concerné"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            placeholder="Identifiant d’un atelier, d’une fiche…"
          />
          <div className={styles.rowActions}>
            <Button type="submit">Rechercher</Button>
          </div>
        </form>
      </Panel>

      <Panel>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : entries.length === 0 ? (
          <EmptyState title="Aucune entrée" text="Aucune action ne correspond à ce filtre." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Auteur</th>
                  <th>Objet</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {new Date(entry.createdAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{ACTIONS[entry.action] ?? entry.action}</td>
                    <td>
                      {entry.actorName ?? "—"}
                      {entry.actorRole ? (
                        <span className={styles.muted}> ({entry.actorRole})</span>
                      ) : null}
                    </td>
                    <td className={styles.muted}>
                      {entry.targetType} · {entry.targetId.slice(-8)}
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
