"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import {
  FieldCard,
  FieldHead,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
import { apiFetch } from "@/lib/api";

import type { Mission } from "./mission";
import { NEXT_ACTION, VEHICLES } from "./mission";

/**
 * Missions du jour.
 *
 * L'ordre est celui du travail, pas celui de la base : ce qui est déjà en
 * main passe avant ce qui reste à récupérer. Un livreur qui a un colis dans
 * son coffre doit le déposer avant d'en charger un autre.
 */
export default function CourierMissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<Mission[]>("/courier/missions")
      .then(setMissions)
      .catch(() => setMissions([]))
      .finally(() => setLoading(false));
  }, []);

  const ordered = [...missions].sort(
    (a, b) => workOrder(a.status) - workOrder(b.status),
  );

  return (
    <>
      <FieldHead
        title="Mes missions"
        subtitle={
          missions.length === 0
            ? undefined
            : `${missions.length} course${missions.length > 1 ? "s" : ""} en cours`
        }
      />

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : missions.length === 0 ? (
        <FieldCard>
          <p className={styles.muted}>
            Aucune mission pour l’instant. Déclarez-vous disponible en haut de l’écran : Ojà
            vous affecte les courses selon votre véhicule et votre position.
          </p>
        </FieldCard>
      ) : (
        ordered.map((mission) => (
          <FieldCard key={mission.reference} tone="action">
            <div className={styles.rows}>
              <div>
                <strong style={{ textAlign: "left" }}>{mission.reference}</strong>
                <Badge type={mission.status === "TO_PICK_UP" ? "warning" : "info"}>
                  {mission.statusLabel}
                </Badge>
              </div>
            </div>

            <div className={styles.rows}>
              <div>
                <span>Enlèvement</span>
                <strong>{mission.pickup.shopName}</strong>
              </div>
              <div>
                <span>Livraison</span>
                <strong>{mission.drop.fullName}</strong>
              </div>
              <div>
                <span>Distance</span>
                <strong>{mission.distanceKm.toFixed(1)} km</strong>
              </div>
              <div>
                <span>Véhicule</span>
                <strong>{VEHICLES[mission.vehicle] ?? mission.vehicle}</strong>
              </div>
            </div>

            <ButtonLink href={`/espace-livreur/missions/${mission.reference}`} fullWidth>
              {NEXT_ACTION[mission.status] ?? "Ouvrir la mission"}
            </ButtonLink>
          </FieldCard>
        ))
      )}

      {!loading && missions.length > 0 ? (
        <p className={styles.muted}>
          <Link href="/espace-livreur/historique">Voir les courses terminées</Link>
        </p>
      ) : null}
    </>
  );
}

/** Ce qui est en main d'abord, ce qui reste à charger ensuite. */
function workOrder(status: string): number {
  return (
    { IN_DELIVERY: 0, PICKED_UP: 1, RETURN_REQUIRED: 2, TO_PICK_UP: 3 }[status] ?? 9
  );
}
