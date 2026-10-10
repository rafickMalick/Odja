"use client";

import type { ExhibitionPassView } from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import { EmptyState, PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { dateRange } from "@/lib/exhibitions";
import { formatFcfa } from "@/lib/format";

/** Billets, inscriptions et invitations du visiteur (§ 8 et § 12). */
export default function MyPassesPage() {
  const [passes, setPasses] = useState<ExhibitionPassView[] | null>(null);

  useEffect(() => {
    void apiFetch<ExhibitionPassView[]>("/exhibitions/passes/mine")
      .then(setPasses)
      .catch(() => setPasses([]));
  }, []);

  return (
    <>
      <PageHead title="Mes billets" subtitle="Vos accès aux expositions, sur place comme en ligne." />
      {passes === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : passes.length === 0 ? (
        <Panel>
          <EmptyState
            title="Aucun billet"
            text="Les inscriptions et billets d’exposition apparaîtront ici."
            action={<ButtonLink href="/expositions">Voir les expositions</ButtonLink>}
          />
        </Panel>
      ) : (
        <Panel>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exposition</th>
                  <th>Référence</th>
                  <th>Accès</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {passes.map((pass) => (
                  <tr key={pass.reference}>
                    <td>
                      <Link href={`/expositions/${pass.exhibition.slug}`}>{pass.exhibition.title}</Link>
                      <p className={styles.muted}>{dateRange(pass.exhibition.startsAt, pass.exhibition.endsAt)}</p>
                    </td>
                    <td>{pass.reference}</td>
                    <td>
                      {pass.kind === "TICKET"
                        ? `Billet ${formatFcfa(pass.amountXof)}`
                        : pass.kind === "REGISTRATION"
                          ? "Inscription"
                          : "Invitation"}
                      {" · "}
                      {pass.format === "ONSITE" ? "sur place" : "en ligne"}
                    </td>
                    <td>
                      <Badge type={pass.status === "CONFIRMED" ? "success" : "pending"}>
                        {pass.status === "CONFIRMED" ? "Confirmé" : "Paiement en attente"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
