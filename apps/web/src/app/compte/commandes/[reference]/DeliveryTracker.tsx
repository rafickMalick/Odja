"use client";

import type { ShipmentTrackEvent, ShipmentTrackView } from "@oja/contracts";
import { useEffect, useRef, useState } from "react";

import { API_BASE_URL, apiFetch } from "@/lib/api";

import order from "./order.module.css";

/**
 * Suivi de livraison en direct (cahier F1-07).
 *
 * Le flux passe par **SSE** (`EventSource`), pas par WebSocket. Si la
 * connexion échoue  proxy, réseau capricieux  on retombe sur une relecture
 * de l'instantané toutes les 15 s. Aucune carte : une frise d'étapes et la
 * dernière position connue en clair suffisent à savoir où en est le colis.
 */

/* Même chemin que les autres appels : par le site, pour que le cookie de
   session accompagne le flux. */
const API_BASE = API_BASE_URL;
const CLOSED = new Set(["DELIVERED", "RETURNED", "FAILED"]);

export function DeliveryTracker({ reference }: { reference: string }) {
  const [view, setView] = useState<ShipmentTrackView | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;

    const applyEvent = (event: ShipmentTrackEvent) => {
      setView((current) => {
        if (!current) return current;
        const known = current.events.some(
          (existing) => existing.at === event.at && existing.status === event.status,
        );
        return {
          ...current,
          status: event.status,
          statusLabel: event.statusLabel || current.statusLabel,
          lastPosition:
            event.latitude != null && event.longitude != null
              ? { latitude: event.latitude, longitude: event.longitude, at: event.at }
              : current.lastPosition,
          events: known ? current.events : [...current.events, event],
        };
      });
    };

    const startPolling = () => {
      if (pollRef.current != null) return;
      const tick = async () => {
        try {
          const snapshot = await apiFetch<ShipmentTrackView>(
            `/shipments/${reference}/track`,
          );
          if (!stopped) setView(snapshot);
          if (snapshot && CLOSED.has(snapshot.status) && pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          /* on retentera au prochain tick */
        }
      };
      void tick();
      pollRef.current = window.setInterval(() => void tick(), 15_000);
    };

    let source: EventSource | null = null;
    try {
      source = new EventSource(`${API_BASE}/shipments/${reference}/stream`, {
        withCredentials: true,
      });
      source.addEventListener("snapshot", (raw) => {
        try {
          setView(JSON.parse((raw as MessageEvent).data) as ShipmentTrackView);
        } catch {
          /* ignore */
        }
      });
      source.addEventListener("event", (raw) => {
        try {
          applyEvent(JSON.parse((raw as MessageEvent).data) as ShipmentTrackEvent);
        } catch {
          /* ignore */
        }
      });
      source.onerror = () => {
        // Fin normale du flux (colis livré) ou coupure : on bascule en polling.
        source?.close();
        source = null;
        if (!stopped) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      stopped = true;
      source?.close();
      if (pollRef.current != null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [reference]);

  if (!view) return null;

  const timeline = [...view.events].reverse();

  return (
    <div className={order.tracker}>
      <p className={order.trackerHead}>
        Suivi de la livraison : <strong>{view.statusLabel}</strong>
      </p>

      {view.lastPosition ? (
        <p className={order.trackerPos}>
          Dernière position connue à {formatTime(view.lastPosition.at)}.
        </p>
      ) : null}

      <ol className={order.trackerList}>
        {timeline.map((event, index) => (
          <li key={`${event.at}-${index}`} data-current={index === 0 || undefined}>
            <span className={order.trackerStep}>{event.statusLabel}</span>
            {event.note ? <span className={order.trackerNote}> · {event.note}</span> : null}
            <span className={order.trackerTime}>{formatTime(event.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
