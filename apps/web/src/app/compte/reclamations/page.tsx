"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

import { DISPUTE_TONE } from "../status";

/**
 * Mes réclamations.
 *
 * Le client parle à Ojà, jamais au créateur : c'est la règle qui fonde la
 * place de marché, et l'écran ne laisse aucune ambiguïté là-dessus.
 */

interface Dispute {
  reference: string;
  orderReference: string;
  status: keyof typeof DISPUTE_TONE;
  statusLabel: string;
  reasonLabel: string;
  refundXof: number | null;
  slaDueAt: string;
  overdue: boolean;
  createdAt: string;
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<Dispute[]>("/disputes")
      .then(setDisputes)
      .catch(() => setDisputes([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHead
        title="Mes réclamations"
        subtitle="Ojà examine chaque demande et vous répond ici. Vous n’avez jamais à contacter l’atelier."
      />

      <Panel>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : disputes.length === 0 ? (
          <EmptyState
            title="Aucune réclamation"
            text="Si une pièce ne vous convient pas à la livraison, signalez-le depuis la commande concernée."
            action={<ButtonLink href="/compte">Voir mes commandes</ButtonLink>}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Commande</th>
                  <th>Motif</th>
                  <th>État</th>
                  <th className={styles.numeric}>Remboursé</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((dispute) => (
                  <tr key={dispute.reference}>
                    <td>
                      <Link href={`/compte/reclamations/${dispute.reference}`}>
                        {dispute.reference}
                      </Link>
                    </td>
                    <td>{dispute.orderReference}</td>
                    <td>{dispute.reasonLabel}</td>
                    <td>
                      <Badge type={DISPUTE_TONE[dispute.status] ?? "pending"}>
                        {dispute.statusLabel}
                      </Badge>
                    </td>
                    <td className={styles.numeric}>
                      {dispute.refundXof !== null ? formatFcfa(dispute.refundXof) : "Aucun"}
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
