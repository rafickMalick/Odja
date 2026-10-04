"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { apiFetch } from "@/lib/api";

import styles from "./FieldShell.module.css";

/**
 * Coquille de l'espace livreur.
 *
 * Elle ne réutilise pas la barre latérale des autres espaces, et c'est
 * délibéré. Le livreur est le seul profil qui travaille **dehors**, en
 * mouvement, sur un téléphone tenu d'une main : la navigation descend en bas
 * de l'écran, à portée du pouce, et les cibles ne descendent jamais sous
 * 44 px. Un menu qu'on ouvre au coin supérieur gauche, casque sur la tête, ne
 * s'ouvre pas.
 *
 * Le langage visuel reste celui d'Ojà  mêmes tokens, mêmes polices, même
 * orange pour ce qui demande une action.
 */

export interface FieldTab {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number | undefined;
}

export function FieldShell({
  title,
  tabs,
  children,
  notice,
  status,
}: {
  title: string;
  tabs: FieldTab[];
  children: ReactNode;
  notice?: ReactNode;
  /** Interrupteur de disponibilité, affiché en tête quand il existe. */
  status?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  /* Même règle que la barre latérale : un seul onglet actif, le plus précis.
     Voir Workspace.tsx. */
  const activeHref = tabs
    .filter((tab) => tab.href === pathname || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
    router.refresh();
  };

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Ojà, accueil">
          <img src="/images/logo-oja.svg" alt="" className={styles.logo} />
          <span className={styles.space}>{title}</span>
        </Link>
        <div className={styles.topActions}>
          {/* Retour au site public sans quitter son espace. */}
          <Link href="/" className={styles.homeLink}>
            Accueil
          </Link>
          <button type="button" onClick={logout} className={styles.logout}>
            Se déconnecter
          </button>
        </div>
      </header>

      {status ? <div className={styles.statusBand}>{status}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <main className={styles.content}>{children}</main>

      <nav className={styles.tabbar} aria-label={title}>
        {tabs.map((tab) => {
          const active = tab.href === activeHref;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                {tab.icon}
                {tab.badge ? <span className={styles.tabBadge}>{tab.badge}</span> : null}
              </span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Titre de page. Plus sobre que celui des espaces de bureau : l'écran est petit. */
export function FieldHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className={styles.head}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );
}

export function FieldCard({
  children,
  tone,
}: {
  children: ReactNode;
  /** `action` met la carte en avant : c'est celle qui attend un geste. */
  tone?: "action";
}) {
  return (
    <section className={`${styles.card} ${tone === "action" ? styles.cardAction : ""}`}>
      {children}
    </section>
  );
}

export { styles as fieldShellStyles };

/* ── Icônes ──
   Dessinées à la main plutôt qu'importées : cinq traits ne justifient pas une
   dépendance, et la charte CSP interdit de toute façon un CDN. */

export const MissionIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 7h16M4 12h16M4 17h16"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const MoneyIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export const ProfileIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const HistoryIcon = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
