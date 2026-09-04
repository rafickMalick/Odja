"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import {
  FieldCard,
  FieldHead,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
import { apiFetch } from "@/lib/api";

import type { Mission } from "../mission";

/** Courses terminées. Le numéro du client n'y figure plus, par construction. */
export default function CourierHistoryPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<Mission[]>("/courier/missions?scope=past")
      .then(setMissions)
      .catch(() => setMissions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <FieldHead
        title="Historique"
        subtitle={`${missions.length} course${missions.length > 1 ? "s" : ""} terminée${missions.length > 1 ? "s" : ""}`}
      />

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : missions.length === 0 ? (
        <FieldCard>
          <p className={styles.muted}>Aucune course terminée pour l’instant.</p>
        </FieldCard>
      ) : (
        missions.map((mission) => (
          <FieldCard key={mission.reference}>
            <div className={styles.rows}>
              <div>
                <Link href={`/espace-livreur/missions/${mission.reference}`}>
                  {mission.reference}
                </Link>
                <Badge type={mission.status === "DELIVERED" ? "success" : "danger"}>
                  {mission.statusLabel}
                </Badge>
              </div>
              <div>
                <span>{mission.pickup.shopName}</span>
                <strong>{mission.distanceKm.toFixed(1)} km</strong>
              </div>
            </div>
          </FieldCard>
        ))
      )}
    </>
  );
}
