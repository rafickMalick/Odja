"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Workspace, type WorkspaceLink } from "@/components/dashboard/Workspace";
import { loginUrl } from "@/lib/login-redirect";

import { MakerStatusProvider, useMakerStatus } from "./maker-context";

const ONBOARDING_PATH = "/espace-createur/boutique";
const SUPPORT_PATH = "/espace-createur/support";

/**
 * Coquille de l'espace créateur.
 *
 * Tant que la boutique n'est pas créée et le dossier déposé, l'espace ne
 * propose qu'un seul endroit : la page qui les recueille. Ce n'est pas un
 * bandeau qu'on peut ignorer en cliquant ailleurs  les autres pages ne sont
 * simplement pas atteignables, et une tentative directe par l'URL y ramène.
 *
 * Une fois le dossier déposé (statut `PENDING`), l'espace s'ouvre en entier :
 * on n'attend pas la décision de l'administration pour laisser l'artisan
 * préparer ses fiches. C'est la validation du **dépôt**, pas encore
 * l'approbation, qui débloque  l'approbation, elle, ne débloque que la mise
 * en vente réelle (déjà gardée côté API).
 */
export function MakerShell({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <MakerStatusProvider onUnauthorized={() => router.push(loginUrl("/espace-createur"))}>
      <Gate>{children}</Gate>
    </MakerStatusProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { maker, state, locked } = useMakerStatus();

  /* Le verrou agit sur l'URL, pas seulement sur ce qui s'affiche : sans ce
     remplacement, taper directement /espace-createur/produits dans la barre
     d'adresse suffirait à contourner l'étape. */
  /* Le support reste ouvert pendant l'inscription : c'est précisément quand
     un dossier bloque qu'on a besoin d'écrire à Ojà. */
  const reachableWhileLocked =
    pathname === ONBOARDING_PATH || pathname.startsWith(SUPPORT_PATH);

  useEffect(() => {
    if (locked && !reachableWhileLocked) {
      router.replace(ONBOARDING_PATH);
    }
  }, [locked, reachableWhileLocked, router]);

  const links: WorkspaceLink[] = locked
    ? [
        { href: ONBOARDING_PATH, label: "Ma boutique" },
        { href: SUPPORT_PATH, label: "Support créateur" },
      ]
    : [
        { href: "/espace-createur", label: "Tableau de bord" },
        { href: "/espace-createur/produits", label: "Mes pièces" },
        { href: "/espace-createur/commandes", label: "Commandes" },
        { href: "/espace-createur/portefeuille", label: "Portefeuille" },
        { href: "/espace-createur/boutique", label: "Ma boutique" },
        { href: SUPPORT_PATH, label: "Support créateur" },
      ];

  if (state === "loading") {
    return (
      <Workspace title="Espace créateur" links={links}>
        <p>Chargement…</p>
      </Workspace>
    );
  }

  return (
    <Workspace title="Espace créateur" links={links} notice={noticeFor(maker, state)}>
      {/* Tant que verrouillé, seule /boutique est jamais montée : les autres
          pages ne peuvent pas faire d'appel avant que la coquille les ait
          laissées passer. */}
      {locked && !reachableWhileLocked ? null : children}
    </Workspace>
  );
}

/**
 * Bandeau d'état du dossier.
 *
 * Chaque message dit **ce qu'il faut faire ensuite**. « Dossier en attente »
 * sans suite laisse l'artisan rappeler le support pour demander quoi faire.
 */
function noticeFor(
  maker: { kycStatus: string; kycRejectReason: string | null } | null,
  state: string,
): ReactNode {
  if (state === "no-shop") {
    return "Bienvenue ! Renseignez votre boutique pour accéder à votre espace.";
  }

  if (!maker) return null;

  switch (maker.kycStatus) {
    case "NOT_SUBMITTED":
      return "Complétez votre dossier et déposez-le : c'est ce qui ouvre le reste de votre espace.";
    case "PENDING":
      return "Dossier déposé, en cours de vérification par Ojà. Vous pouvez déjà préparer vos fiches : elles partiront en vente dès la validation.";
    case "REJECTED":
      return `Dossier refusé${maker.kycRejectReason ? ` : ${maker.kycRejectReason}` : ""}. Corrigez-le et redéposez-le pour retrouver votre espace.`;
    default:
      return null;
  }
}
