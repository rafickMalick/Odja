"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, apiFetchOrNull } from "@/lib/api";

import styles from "./NotificationsBell.module.css";

/**
 * Cloche de notifications in-app (cahier LN-04).
 *
 * Le compteur se rafraîchit toutes les 60 s ; la liste n'est chargée qu'à
 * l'ouverture du panneau. « Tout marquer lu » remet le compteur à zéro sans
 * recharger la page. Un échec réseau est silencieux : une cloche ne doit pas
 * casser l'en-tête.
 */

interface NotificationItem {
  id: string;
  template: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

export function NotificationsBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    const result = await apiFetchOrNull<{ count: number }>("/notifications/unread-count");
    if (result) setCount(result.count);
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => void refreshCount(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshCount]);

  // Fermeture au clic extérieur et à Échap.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const page = await apiFetchOrNull<{ items: NotificationItem[] }>(
        "/notifications?limit=15",
      );
      setItems(page?.items ?? []);
    }
  }

  async function markAllRead() {
    try {
      await apiFetch("/notifications/read", { method: "POST", body: {} });
    } catch {
      /* réessayer suffit */
    }
    setCount(0);
    setItems((current) =>
      current
        ? current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))
        : current,
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={
          count > 0 ? `Notifications, ${count} non lue${count > 1 ? "s" : ""}` : "Notifications"
        }
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path
            d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M10 19a2 2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        {count > 0 ? <span className={styles.dot}>{count > 9 ? "9+" : count}</span> : null}
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.head}>
            <span>Notifications</span>
            {count > 0 ? (
              <button type="button" className={styles.link} onClick={() => void markAllRead()}>
                Tout marquer lu
              </button>
            ) : null}
          </div>

          {items === null ? (
            <p className={styles.empty}>Chargement…</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>Rien pour le moment.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className={styles.item}
                    data-unread={item.readAt ? undefined : true}
                    onClick={() => setOpen(false)}
                  >
                    <span className={styles.itemTitle}>{item.title}</span>
                    <span className={styles.itemBody}>{item.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link href="/compte/notifications" className={styles.all} onClick={() => setOpen(false)}>
            Tout voir
          </Link>
        </div>
      ) : null}
    </div>
  );
}
