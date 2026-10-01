"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import admin from "../admin.module.css";

/**
 * Affectation des livreurs.
 *
 * Le cahier client confie l'affectation à l'équipe Ojà, pas à un algorithme :
 * l'écran propose donc les livreurs éligibles  disponibles, validés, dont le
 * véhicule suffit  et laisse la décision à l'agent.
 *
 * Une commande passée chez deux ateliers produit **deux expéditions**, chacune
 * enlevée chez son créateur : elles apparaissent séparément.
 */

interface Shipment {
  reference: string;
  orderReference: string;
  shopName: string;
  pickupLine1: string;
  dropLine1: string;
  vehicle: string;
  distanceKm: number;
  weightKg: number;
}

interface Courier {
  id: string;
  name: string;
  vehicle: string;
  ratingAvg: number;
  suitable: boolean;
}

const VEHICLES: Record<string, string> = {
  MOTO: "Moto",
  TRICYCLE: "Tricycle",
  VAN: "Camionnette",
  TRUCK: "Camion",
};

export default function AdminShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setShipments(await apiFetch<Shipment[]>("/admin/logistics/unassigned"));
    } catch {
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead
        title="Expéditions à affecter"
        subtitle="Une expédition par atelier. Le livreur est choisi ici, puis prévenu."
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Chargement…</p>
      ) : shipments.length === 0 ? (
        <Panel>
          <EmptyState
            title="Aucune expédition en attente"
            text="Les expéditions apparaissent dès qu’un créateur signale une pièce prête pour l’enlèvement."
          />
        </Panel>
      ) : (
        shipments.map((shipment) => (
          <ShipmentCard
            key={shipment.reference}
            shipment={shipment}
            onAssigned={load}
            onError={setError}
          />
        ))
      )}
    </>
  );
}

function ShipmentCard({
  shipment,
  onAssigned,
  onError,
}: {
  shipment: Shipment;
  onAssigned: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCouriers = async () => {
    setBusy(true);
    setCouriers(
      await apiFetch<Courier[]>(
        `/admin/logistics/shipments/${shipment.reference}/couriers`,
      ).catch(() => []),
    );
    setBusy(false);
  };

  const assign = async (courierId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/admin/logistics/shipments/${shipment.reference}/assign`, {
        method: "POST",
        body: { courierId },
      });
      await onAssigned();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={shipment.reference}
      action={<span className={styles.muted}>Commande {shipment.orderReference}</span>}
    >
      <dl className={admin.details}>
        <div>
          <dt>Atelier</dt>
          <dd>{shipment.shopName}</dd>
        </div>
        <div>
          <dt>Enlèvement</dt>
          <dd>{shipment.pickupLine1}</dd>
        </div>
        <div>
          <dt>Livraison</dt>
          <dd>{shipment.dropLine1}</dd>
        </div>
        <div>
          <dt>Véhicule requis</dt>
          <dd>{VEHICLES[shipment.vehicle] ?? shipment.vehicle}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{shipment.distanceKm.toFixed(1)} km</dd>
        </div>
        <div>
          <dt>Poids</dt>
          <dd>{shipment.weightKg} kg</dd>
        </div>
      </dl>

      {couriers === null ? (
        <Button type="button" variant="outline" onClick={() => void loadCouriers()} disabled={busy}>
          {busy ? "Recherche…" : "Choisir un livreur"}
        </Button>
      ) : couriers.length === 0 ? (
        <p className={styles.error}>
          Aucun livreur disponible et validé. Vérifiez les dossiers livreurs.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Livreur</th>
                <th>Véhicule</th>
                <th className={styles.numeric}>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {couriers.map((courier) => (
                <tr key={courier.id}>
                  <td>{courier.name}</td>
                  <td>{VEHICLES[courier.vehicle] ?? courier.vehicle}</td>
                  <td className={styles.numeric}>
                    {courier.ratingAvg > 0 ? courier.ratingAvg.toFixed(1) : ""}
                  </td>
                  <td className={styles.rowActions}>
                    {courier.suitable ? (
                      <Button
                        type="button"
                        onClick={() => void assign(courier.id)}
                        disabled={busy}
                      >
                        Affecter
                      </Button>
                    ) : (
                      /* Un véhicule trop petit n'est pas masqué : l'agent doit
                         savoir que le livreur existe mais ne convient pas. */
                      <span className={styles.muted}>véhicule insuffisant</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
