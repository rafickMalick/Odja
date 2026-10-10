"use client";

import type { OrganizerExhibition } from "@oja/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import { EmptyState, PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";
import { STATUS_LABELS, STATUS_TONE, dateRange } from "@/lib/exhibitions";

/** Les dossiers d'exposition de l'organisateur, du brouillon à la mise en ligne. */
export default function MyExhibitionsPage() {
  const [items, setItems] = useState<OrganizerExhibition[] | null>(null);

  useEffect(() => {
    void apiFetch<OrganizerExhibition[]>("/my/exhibitions")
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  return (
    <>
      <PageHead
        title="Mes expositions"
        subtitle="Montez votre dossier, suivez son examen, partagez l’exposition une fois en ligne."
        action={<ButtonLink href="/expositions/mes-expositions/nouvelle">Nouvelle exposition</ButtonLink>}
      />

      {items === null ? (
        <p className={styles.muted}>Chargement…</p>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title="Aucune exposition pour l’instant"
            text="Décrivez votre projet, ajoutez les œuvres, choisissez une formule : l’équipe Ojà l’examine ensuite."
            action={<ButtonLink href="/expositions/mes-expositions/nouvelle">Créer un dossier</ButtonLink>}
          />
        </Panel>
      ) : (
        <Panel>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Exposition</th>
                  <th>Dates</th>
                  <th>Œuvres</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map((exhibition) => (
                  <tr key={exhibition.id}>
                    <td>
                      <Link href={`/expositions/mes-expositions/${exhibition.id}`}>{exhibition.title}</Link>
                    </td>
                    <td>{dateRange(exhibition.startsAt, exhibition.endsAt)}</td>
                    <td>{exhibition.works.length}</td>
                    <td>
                      <Badge type={STATUS_TONE[exhibition.status]}>{STATUS_LABELS[exhibition.status]}</Badge>
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
