"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Workspace, type WorkspaceLink } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { loginUrl } from "@/lib/login-redirect";

/**
 * Coquille de l'espace client.
 *
 * Elle reprend la barre latérale des autres espaces plutôt que d'inventer une
 * troisième mise en page : un client consulte ses commandes depuis un
 * ordinateur aussi souvent que depuis un téléphone, et la barre se replie déjà
 * en tiroir sur petit écran.
 *
 * La pastille compte **les livraisons qui attendent sa validation**. C'est le
 * clic qui décide du sort de l'argent : sans rappel, il n'arrive jamais, et
 * chaque commande attend 72 h la validation automatique.
 */

interface Order {
  reference: string;
  subOrders: { status: string }[];
}

export function AccountShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [toValidate, setToValidate] = useState(0);
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { items: orders } = await apiFetch<{ items: Order[] }>("/orders?limit=100");
        if (cancelled) return;
        setToValidate(
          orders.reduce(
            (total, order) =>
              total + order.subOrders.filter((sub) => sub.status === "DELIVERED").length,
            0,
          ),
        );
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.isUnauthorized) {
          router.push(loginUrl("/compte"));
          return;
        }
        setState("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const links: WorkspaceLink[] = [
    { href: "/compte", label: "Mes commandes", badge: toValidate || undefined },
    { href: "/compte/billets", label: "Mes billets" },
    { href: "/expositions/mes-expositions", label: "Mes expositions" },
    { href: "/compte/reclamations", label: "Mes réclamations" },
    { href: "/compte/support", label: "Service client" },
    { href: "/compte/notifications", label: "Notifications" },
    { href: "/compte/adresses", label: "Mes adresses" },
    { href: "/compte/profil", label: "Mon profil" },
  ];

  return (
    <Workspace title="Mon compte" links={links}>
      {state === "loading" ? <p>Chargement…</p> : children}
    </Workspace>
  );
}
