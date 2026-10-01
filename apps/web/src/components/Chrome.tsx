"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Footer } from "./Footer";
import { Header } from "./Header";

/* Les écrans d'authentification sont dessinés en pleine page, sans nav bar
   ni footer : on retire le chrome commun sur ces routes.

   Les espaces de travail  créateur, livreur, administration  ont leur propre
   chrome : une barre latérale à la place du menu marketing, et pas de pied de
   page. Un artisan qui gère son stock n'a que faire d'un appel à s'inscrire à
   la newsletter. */
const BARE_ROUTES = [
  "/connexion",
  "/inscription",
  "/verifier-email",
  "/espace-createur",
  "/espace-livreur",
  "/admin",
  "/compte",
];

export function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.some((route) => pathname.startsWith(route));

  if (bare) return <>{children}</>;

  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
