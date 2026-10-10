"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Workspace } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { loginUrl } from "@/lib/login-redirect";

/**
 * Espace de l'organisateur.
 *
 * Ouvert à tout compte : un créateur inscrit comme un organisateur externe
 * (§ 6.2). Un visiteur non connecté est renvoyé vers la connexion, puis
 * ramené ici.
 */
export default function OrganizerLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void apiFetch("/my/exhibitions")
      .then(() => setReady(true))
      .catch((cause) => {
        if (cause instanceof ApiError && (cause.isUnauthorized || cause.problem.status === 404)) {
          router.push(loginUrl("/expositions/mes-expositions"));
          return;
        }
        setReady(true);
      });
  }, [router]);

  return (
    <Workspace
      title="Mes expositions"
      links={[
        { href: "/expositions/mes-expositions", label: "Mes dossiers" },
        { href: "/expositions/mes-expositions/nouvelle", label: "Nouvelle exposition" },
        { href: "/expositions/proposer", label: "Formules et étapes" },
      ]}
    >
      {ready ? children : <p>Chargement…</p>}
    </Workspace>
  );
}
