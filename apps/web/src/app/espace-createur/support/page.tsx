"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHead, Panel } from "@/components/dashboard/Workspace";
import { MyTickets } from "@/components/support/MyTickets";
import { NewTicketForm } from "@/components/support/NewTicketForm";
import { apiFetch } from "@/lib/api";

/**
 * Support créateur.
 *
 * Les mêmes demandes que côté acheteur, avec les types de problème d'un
 * vendeur (paiements et retraits, validation des pièces, commandes reçues,
 * litiges…), fournis par l'API selon le rôle.
 */

interface Me {
  firstName: string;
  lastName: string;
  email: string;
}

export default function MakerSupportPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void apiFetch<Me>("/auth/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  return (
    <>
      <PageHead
        title="Support créateur"
        subtitle="Paiements, validation de vos pièces, commandes reçues : écrivez au service client, la réponse arrive ici."
      />

      <Panel title="Contacter le service client">
        <NewTicketForm
          identity={me ? { name: `${me.firstName} ${me.lastName}`, email: me.email } : null}
          onCreated={(ticket) => {
            setRefreshKey((key) => key + 1);
            router.push(`/espace-createur/support/${ticket.reference}`);
          }}
        />
      </Panel>

      <Panel title="Mes demandes">
        <MyTickets basePath="/espace-createur/support" refreshKey={refreshKey} />
      </Panel>
    </>
  );
}
