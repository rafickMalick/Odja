"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Workspace, type WorkspaceLink } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch, isMfaRequired } from "@/lib/api";
import { loginUrl } from "@/lib/login-redirect";

/**
 * Coquille du back-office.
 *
 * Les pastilles portent les deux files qui bloquent tout le reste : un dossier
 * en attente, c'est un atelier qui ne peut rien vendre ; une fiche en attente,
 * c'est une pièce qui n'existe pour personne. Elles sont donc comptées ici, une
 * fois, plutôt que sur chaque page.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [makers, setMakers] = useState(0);
  const [couriers, setCouriers] = useState(0);
  const [products, setProducts] = useState(0);
  const [shipments, setShipments] = useState(0);
  const [disputes, setDisputes] = useState(0);
  const [tickets, setTickets] = useState(0);
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        /* La première requête sert aussi de contrôle d'accès : si elle échoue
           en 401, on n'est pas administrateur, et rien d'autre n'a de sens. */
        const pendingMakers = await apiFetch<unknown[]>("/admin/makers?status=PENDING");
        if (cancelled) return;
        setMakers(pendingMakers.length);
        setState("ready");

        const [pendingCouriers, pendingProducts, unassigned, openDisputes, openTickets] =
          await Promise.all([
            apiFetch<unknown[]>("/admin/couriers?status=PENDING").catch(() => []),
            apiFetch<unknown[]>("/admin/catalog/products/pending").catch(() => []),
            apiFetch<unknown[]>("/admin/logistics/unassigned").catch(() => []),
            apiFetch<unknown[]>("/admin/disputes?open=true").catch(() => []),
            apiFetch<{ count: number }>("/admin/support/tickets/pending-count").catch(() => ({
              count: 0,
            })),
          ]);
        if (cancelled) return;
        setCouriers(pendingCouriers.length);
        setProducts(pendingProducts.length);
        setShipments(unassigned.length);
        setDisputes(openDisputes.length);
        setTickets(openTickets.count);
      } catch (cause) {
        if (cancelled) return;
        // Double authentification à activer : apiFetch y emmène déjà.
        if (isMfaRequired(cause)) return;
        /* 401 comme 404 mènent au même endroit : l'API répond 404 à qui n'a pas
           le rôle, précisément pour ne pas confirmer que ces routes existent. */
        if (cause instanceof ApiError && cause.isUnauthorized) {
          router.push(loginUrl("/admin"));
          return;
        }
        router.push("/");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const links: WorkspaceLink[] = [
    { href: "/admin", label: "Vue d'ensemble" },
    { href: "/admin/ateliers", label: "Dossiers créateurs", badge: makers || undefined },
    { href: "/admin/livreurs", label: "Dossiers livreurs", badge: couriers || undefined },
    { href: "/admin/catalogue", label: "Fiches à valider", badge: products || undefined },
    { href: "/admin/commandes", label: "Expéditions", badge: shipments || undefined },
    { href: "/admin/commandes/recherche", label: "Rechercher" },
    { href: "/admin/litiges", label: "Réclamations", badge: disputes || undefined },
    { href: "/admin/support", label: "Service client", badge: tickets || undefined },
    { href: "/admin/finances", label: "Grand livre" },
    { href: "/admin/promo-codes", label: "Codes promo" },
    { href: "/admin/journal", label: "Journal d'audit" },
    { href: "/admin/equipe", label: "Administrateurs" },
    { href: "/double-authentification", label: "Double authentification" },
    { href: "/admin/reglages", label: "Réglages" },
    { href: "/admin/outils", label: "Outils" },
  ];

  return (
    <Workspace title="Administration Ojà" links={links}>
      {state === "loading" ? <p>Chargement…</p> : children}
    </Workspace>
  );
}
