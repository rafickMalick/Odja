"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import {
  FieldCard,
  FieldHead,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
import { apiFetch } from "@/lib/api";
import { formatFcfa } from "@/lib/format";

/**
 * Gains du livreur.
 *
 * L'écran annonce ce qu'il sait et ne prétend pas à un montant définitif : la
 * règle de rémunération n'est pas arrêtée, et la totalité des frais de
 * livraison est provisionnée en attendant. Afficher un chiffre net sans
 * préciser cela reviendrait à promettre ce que personne n'a décidé.
 */

interface Earnings {
  deliveryFeesCollectedXof: number;
  scheduledXof: number;
  readyXof: number;
  paidXof: number;
  deliveredCount: number;
  items: {
    id: string;
    amountXof: number;
    status: string;
    shipmentReference: string | null;
    releaseAt: string | null;
    paidAt: string | null;
    createdAt: string;
  }[];
}

const STATUS: Record<string, { type: "pending" | "success" | "info" | "danger"; label: string }> = {
  SCHEDULED: { type: "pending", label: "Programmé" },
  READY: { type: "info", label: "Prêt à verser" },
  PROCESSING: { type: "info", label: "En cours" },
  PAID: { type: "success", label: "Versé" },
  FAILED: { type: "danger", label: "Échoué" },
};

export default function CourierEarningsPage() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<Earnings>("/courier/earnings")
      .then(setEarnings)
      .catch(() => setEarnings(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.muted}>Chargement…</p>;

  return (
    <>
      <FieldHead title="Mes gains" subtitle={`${earnings?.deliveredCount ?? 0} course(s) livrée(s)`} />

      <FieldCard>
        <div className={styles.rows}>
          <div>
            <span>Frais encaissés sur vos courses</span>
            <strong>{formatFcfa(earnings?.deliveryFeesCollectedXof ?? 0)}</strong>
          </div>
          <div>
            <span>Versement programmé</span>
            <strong>{formatFcfa(earnings?.scheduledXof ?? 0)}</strong>
          </div>
          <div>
            <span>Prêt à verser</span>
            <strong>{formatFcfa(earnings?.readyXof ?? 0)}</strong>
          </div>
          <div>
            <span>Déjà versé</span>
            <strong>{formatFcfa(earnings?.paidXof ?? 0)}</strong>
          </div>
        </div>
        {/* Dire la vérité vaut mieux qu'afficher zéro : la dette existe, sa
            règle de répartition n'est pas encore arrêtée. */}
        <p className={styles.muted}>
          La première ligne est le total des frais de livraison encaissés sur vos courses.
          Ce n’est pas votre gain : le barème qui fixe votre part est en cours de
          finalisation avec Ojà. Vos courses sont comptées et conservées d’ici là.
        </p>
      </FieldCard>

      {(earnings?.items.length ?? 0) === 0 ? (
        <FieldCard>
          <p className={styles.muted}>
            Aucun versement pour l’instant. Il apparaîtra ici dès votre première course
            validée.
          </p>
        </FieldCard>
      ) : (
        earnings?.items.map((item) => {
          const state = STATUS[item.status] ?? { type: "pending" as const, label: item.status };
          return (
            <FieldCard key={item.id}>
              <div className={styles.rows}>
                <div>
                  <span>{item.shipmentReference ?? "Course"}</span>
                  <strong>{formatFcfa(item.amountXof)}</strong>
                </div>
                <div>
                  <Badge type={state.type}>{state.label}</Badge>
                  <strong>{formatDate(item.paidAt ?? item.releaseAt)}</strong>
                </div>
              </div>
            </FieldCard>
          );
        })
      )}
    </>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}
