"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  FieldCard,
  FieldHead,
  fieldShellStyles as styles,
} from "@/components/dashboard/FieldShell";
import { ApiError, apiFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";

import { NEXT_ACTION, VEHICLES, currentPosition, mapLink, type Mission } from "../../mission";
import { ProofForm } from "./ProofForm";

/**
 * Une mission, du chargement à la remise.
 *
 * L'écran ne montre **qu'une action à la fois** : celle que l'état de la
 * course autorise. Un livreur en mouvement ne choisit pas dans un menu, il
 * appuie sur le seul bouton présent.
 */
export default function MissionPage() {
  const params = useParams<{ reference: string }>();
  const router = useRouter();
  const reference = params.reference;

  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<Mission[]>("/courier/missions");
      const found =
        list.find((item) => item.reference === reference) ??
        (await apiFetch<Mission[]>("/courier/missions?scope=past")).find(
          (item) => item.reference === reference,
        );
      if (!found) {
        setError("Cette mission ne vous est pas affectée.");
        return;
      }
      setMission(found);
    } catch {
      setError("Mission introuvable.");
    }
  }, [reference]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Tant que la course est en cours, on pousse la position toutes les 30 s
     pour le suivi du client (cahier L4-15). Le livreur peut couper le
     partage ; il reprend au rechargement. */
  useEffect(() => {
    if (!shareLocation || mission?.status !== "IN_DELIVERY") return;

    let stopped = false;
    const ping = async () => {
      const position = await currentPosition();
      if (stopped || !position) return;
      try {
        await apiFetch(`/courier/missions/${reference}/position`, {
          method: "POST",
          body: position,
        });
      } catch {
        /* on retentera au prochain intervalle */
      }
    };
    void ping();
    const timer = window.setInterval(() => void ping(), 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [shareLocation, mission?.status, reference]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!mission) return <p className={styles.muted}>Chargement…</p>;

  const act = async (action: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/courier/missions/${reference}/${action}`, {
        method: "POST",
        ...(body !== undefined ? { body } : {}),
      });
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  /* Le départ en livraison joint la position si le téléphone la donne. Elle
     n'est pas exigée : refuser de démarrer une course parce que le GPS met
     trente secondes à accrocher serait absurde. */
  const startDelivery = async () => {
    const position = await currentPosition();
    await act("start", position ?? {});
  };

  const delivered = mission.status === "DELIVERED";

  return (
    <>
      <FieldHead title={mission.reference} subtitle={`Commande ${mission.orderReference}`} />

      <FieldCard>
        <div className={styles.rows}>
          <div>
            <span>État</span>
            <Badge type={delivered ? "success" : "info"}>{mission.statusLabel}</Badge>
          </div>
          <div>
            <span>Distance</span>
            <strong>{formatNumber(mission.distanceKm, 1)} km</strong>
          </div>
          <div>
            <span>Véhicule</span>
            <strong>{VEHICLES[mission.vehicle] ?? mission.vehicle}</strong>
          </div>
        </div>
      </FieldCard>

      <FieldCard>
        <h2 className={styles.subtitle}>Enlèvement</h2>
        <div className={styles.stack}>
          <strong>{mission.pickup.shopName}</strong>
          <span className={styles.muted}>{mission.pickup.line1}</span>
          {mission.pickup.landmark ? (
            <span className={styles.muted}>Repère : {mission.pickup.landmark}</span>
          ) : null}
          <a className={styles.callLink} href={mapLink(mission.pickup)}>
            Ouvrir l’itinéraire
          </a>
        </div>
      </FieldCard>

      <FieldCard>
        <h2 className={styles.subtitle}>Livraison</h2>
        <div className={styles.stack}>
          <strong>{mission.drop.fullName}</strong>
          <span className={styles.muted}>{mission.drop.line1}</span>
          {mission.drop.landmark ? (
            <span className={styles.muted}>Repère : {mission.drop.landmark}</span>
          ) : null}
          {mission.drop.phone ? (
            <a className={styles.callLink} href={`tel:${mission.drop.phone}`}>
              Appeler {mission.drop.phone}
            </a>
          ) : (
            /* Le numéro disparaît une fois la course finie : Ojà reste
               l'intermédiaire, y compris après coup. */
            <span className={styles.muted}>
              Le numéro du client n’est visible que pendant la course.
            </span>
          )}
          <a className={styles.callLink} href={mapLink(mission.drop)}>
            Ouvrir l’itinéraire
          </a>
        </div>
      </FieldCard>

      <FieldCard>
        <h2 className={styles.subtitle}>Colis</h2>
        <div className={styles.rows}>
          {mission.items.map((item, index) => (
            <div key={index}>
              <span>{item.productName}</span>
              <strong>× {item.quantity}</strong>
            </div>
          ))}
        </div>
      </FieldCard>

      {error ? <p className={styles.error}>{error}</p> : null}

      {mission.status === "TO_PICK_UP" ? (
        <Button type="button" fullWidth disabled={busy} onClick={() => void act("pickup")}>
          {busy ? "…" : "J’ai récupéré le colis"}
        </Button>
      ) : null}

      {mission.status === "PICKED_UP" ? (
        <Button type="button" fullWidth disabled={busy} onClick={() => void startDelivery()}>
          {busy ? "…" : "Je pars en livraison"}
        </Button>
      ) : null}

      {mission.status === "IN_DELIVERY" ? (
        <>
          <p className={styles.muted}>
            {shareLocation
              ? "Votre position est partagée avec le client pendant la course."
              : "Partage de position coupé."}{" "}
            <button
              type="button"
              onClick={() => setShareLocation((value) => !value)}
              style={{
                border: "none",
                background: "none",
                color: "#d9480f",
                font: "inherit",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {shareLocation ? "Couper" : "Reprendre"}
            </button>
          </p>
          <ProofForm reference={reference} onDelivered={load} />
        </>
      ) : null}

      {delivered ? (
        <p className={styles.success}>
          Colis remis. Le client dispose de 72 h pour valider ; passé ce délai, la validation
          est automatique et votre course est réglée.
        </p>
      ) : null}

      {mission.status === "RETURN_REQUIRED" ? (
        <p className={styles.error}>
          Le client a signalé un problème. Rapportez le colis à l’atelier ; Ojà vous
          recontacte pour la suite.
        </p>
      ) : null}

      {!delivered && mission.status !== "TO_PICK_UP" ? (
        <p className={styles.muted}>{NEXT_ACTION[mission.status]}</p>
      ) : null}
    </>
  );
}
