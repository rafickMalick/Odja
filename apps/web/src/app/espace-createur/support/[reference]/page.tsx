"use client";

import type { TicketView } from "@oja/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SUPPORT_TONE } from "@/app/compte/status";
import { Badge } from "@/components/Badge";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { TicketThread } from "@/components/support/TicketThread";
import support from "@/components/support/support.module.css";
import { ApiError, apiFetch } from "@/lib/api";

/** Une demande du créateur au service client, et son fil de discussion. */
export default function MakerTicketPage() {
  const params = useParams<{ reference: string }>();
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTicket(await apiFetch<TicketView>(`/support/tickets/${params.reference}`));
    } catch {
      setError("Cette demande est introuvable.");
    }
  }, [params.reference]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!ticket) return <p className={styles.muted}>Chargement…</p>;

  const send = async (body: string, _internal: boolean, fileKeys: string[]) => {
    try {
      setTicket(
        await apiFetch<TicketView>(`/support/tickets/${ticket.reference}/messages`, {
          method: "POST",
          body: { body, fileKeys },
        }),
      );
    } catch (cause) {
      throw new Error(cause instanceof ApiError ? cause.message : "Envoi impossible.");
    }
  };

  return (
    <>
      <PageHead
        title={ticket.subject}
        subtitle={`${ticket.reference} · ${ticket.categoryLabel}`}
        action={<Badge type={SUPPORT_TONE[ticket.status] ?? "pending"}>{ticket.statusLabel}</Badge>}
      />

      <p className={support.meta}>
        <span>Ouverte le {new Date(ticket.createdAt).toLocaleDateString("fr-FR")}</span>
        <Link href="/espace-createur/support">Toutes mes demandes</Link>
      </p>

      <Panel title="Échanges avec le service client">
        <TicketThread
          messages={ticket.messages}
          side="customer"
          closed={ticket.status === "CLOSED"}
          onSend={send}
          resolveAttachment={async (key) =>
            (
              await apiFetch<{ url: string }>(
                `/support/tickets/${ticket.reference}/attachment?key=${encodeURIComponent(key)}`,
              )
            ).url
          }
        />
      </Panel>
    </>
  );
}
