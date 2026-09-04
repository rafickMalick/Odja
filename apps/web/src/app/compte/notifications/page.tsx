"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";

/**
 * Toutes mes notifications (cahier LN-04).
 *
 * La cloche de l'en-tête montre les dernières ; cette page les liste toutes,
 * page par page, et permet de tout marquer lu d'un coup.
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

interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void apiFetch<NotificationsPage>("/notifications?limit=30")
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<NotificationsPage>(
        `/notifications?limit=30&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      /* réessayer suffit */
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    try {
      await apiFetch("/notifications/read", { method: "POST", body: {} });
    } catch {
      /* réessayer suffit */
    }
    setItems((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
    );
  }

  const unread = items.filter((item) => !item.readAt).length;

  return (
    <>
      <PageHead
        title="Notifications"
        subtitle="Chaque étape qui appelle un geste de votre part, avec le lien direct."
      />

      <Panel
        title={unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "À jour"}
        action={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => void markAllRead()}>
              Tout marquer lu
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucune notification"
            text="Vous serez prévenu ici à chaque étape de vos commandes et livraisons."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li
                key={item.id}
                style={{
                  padding: "0.85rem 0",
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <Link
                  href={item.href}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <strong style={{ display: "block" }}>
                    {item.readAt ? null : "• "}
                    {item.title}
                  </strong>
                  <span className={styles.muted}>{item.body}</span>
                  <span className={styles.muted} style={{ display: "block", fontSize: "0.8rem" }}>
                    {formatDate(item.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {cursor ? (
          <div style={{ marginTop: "0.9rem" }}>
            <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Chargement…" : "Charger la suite"}
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
