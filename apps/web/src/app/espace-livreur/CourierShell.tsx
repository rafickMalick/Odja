"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  FieldShell,
  HistoryIcon,
  MissionIcon,
  MoneyIcon,
  ProfileIcon,
  fieldShellStyles as styles,
  type FieldTab,
} from "@/components/dashboard/FieldShell";
import { ApiError, apiFetch } from "@/lib/api";

/**
 * Coquille de l'espace livreur.
 *
 * Elle porte deux choses que chaque page n'a pas à répéter : l'état du
 * dossier, et **l'interrupteur de disponibilité**. Ce dernier est en tête de
 * chaque écran parce que c'est le geste le plus fréquent de la journée  on se
 * déclare disponible en montant sur la moto, indisponible en s'arrêtant
 * manger. L'enterrer dans un écran de réglages, c'est garantir qu'il ne sera
 * jamais mis à jour.
 */

interface CourierProfile {
  id: string;
  fullName: string;
  vehicle: string;
  isAvailable: boolean;
  kycStatus: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  kycRejectReason: string | null;
}

export function CourierShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [missions, setMissions] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "no-profile">("loading");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await apiFetch<CourierProfile>("/courier/profile");
      setProfile(mine);
      setState("ready");

      const list = await apiFetch<unknown[]>("/courier/missions").catch(() => []);
      setMissions(list.length);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isUnauthorized) {
        router.push("/connexion?suite=/espace-livreur");
        return;
      }
      // Compte livreur sans profil : c'est le cas normal juste après
      // l'inscription, pas une erreur.
      setState("no-profile");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAvailability = async (isAvailable: boolean) => {
    setSaving(true);
    // Bascule optimiste : sur un réseau lent, un interrupteur qui met deux
    // secondes à réagir se fait cliquer trois fois.
    setProfile((current) => (current ? { ...current, isAvailable } : current));
    try {
      await apiFetch("/courier/availability", { method: "POST", body: { isAvailable } });
    } catch {
      setProfile((current) => (current ? { ...current, isAvailable: !isAvailable } : current));
    } finally {
      setSaving(false);
    }
  };

  const tabs: FieldTab[] = [
    {
      href: "/espace-livreur",
      label: "Missions",
      icon: MissionIcon,
      badge: missions || undefined,
    },
    { href: "/espace-livreur/historique", label: "Historique", icon: HistoryIcon },
    { href: "/espace-livreur/gains", label: "Gains", icon: MoneyIcon },
    { href: "/espace-livreur/profil", label: "Profil", icon: ProfileIcon },
  ];

  const approved = profile?.kycStatus === "APPROVED";

  return (
    <FieldShell
      title="Espace livreur"
      tabs={tabs}
      notice={noticeFor(profile, state)}
      status={
        approved ? (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={profile.isAvailable}
                disabled={saving}
                onChange={(event) => void toggleAvailability(event.target.checked)}
              />
              <span>{profile.isAvailable ? "Disponible" : "Indisponible"}</span>
            </label>
            <span className={styles.muted}>{profile.fullName}</span>
          </>
        ) : undefined
      }
    >
      {state === "loading" ? <p className={styles.muted}>Chargement…</p> : children}
    </FieldShell>
  );
}

/**
 * Bandeau d'état du dossier.
 *
 * Chaque message dit ce qu'il faut faire ensuite. « Dossier en attente » sans
 * suite laisse le livreur appeler le support pour demander quoi faire.
 */
function noticeFor(profile: CourierProfile | null, state: string): ReactNode {
  if (state === "no-profile") {
    return (
      <>
        Votre profil livreur n&apos;est pas encore créé.{" "}
        <Link href="/espace-livreur/profil">Renseignez votre véhicule pour commencer</Link>.
      </>
    );
  }

  if (!profile) return null;

  switch (profile.kycStatus) {
    case "NOT_SUBMITTED":
      return (
        <>
          Déposez votre dossier (pièce d&apos;identité, permis et carte grise) pour recevoir
          des missions. <Link href="/espace-livreur/profil">Compléter</Link>.
        </>
      );
    case "PENDING":
      return <>Dossier déposé, en cours de vérification par Ojà.</>;
    case "REJECTED":
      return (
        <>
          Dossier refusé{profile.kycRejectReason ? ` : ${profile.kycRejectReason}` : ""}.{" "}
          <Link href="/espace-livreur/profil">Corrigez et redéposez</Link>.
        </>
      );
    default:
      return null;
  }
}
