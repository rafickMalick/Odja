"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";

import styles from "./Workspace.module.css";

/**
 * Coquille des espaces de travail  créateur, livreur, administration.
 *
 * Elle reprend le langage visuel de la boutique : mêmes tokens, mêmes polices,
 * même orange. Ce qui change, c'est la **densité** : ici on ne raconte pas, on
 * travaille. Le menu marketing cède la place à une barre latérale, et le pied
 * de page disparaît  un artisan qui gère son stock n'a que faire d'un appel à
 * s'inscrire à la newsletter.
 */

export interface WorkspaceLink {
  href: string;
  label: string;
  /** Pastille de rappel : nombre d'éléments qui attendent une action. */
  badge?: number | undefined;
}

export function Workspace({
  title,
  links,
  children,
  notice,
}: {
  title: string;
  links: WorkspaceLink[];
  children: ReactNode;
  /** Bandeau d'état affiché en tête  dossier en attente, compte suspendu… */
  notice?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /**
   * Un seul lien actif, celui qui colle le plus au chemin courant.
   *
   * Une simple correspondance par préfixe en allumerait deux dès qu'un menu
   * contient `/admin/commandes` **et** `/admin/commandes/recherche`  l'un
   * étant le préfixe de l'autre. On garde le plus long, et le lien racine
   * n'est actif qu'exactement.
   */
  const activeHref = links
    .filter(
      (link) => link.href === pathname || pathname.startsWith(`${link.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/");
    router.refresh();
  };

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar} data-open={open || undefined}>
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="Ojà, accueil">
            <img src="/images/logo-oja.svg" alt="" className={styles.logoImage} />
          </Link>
          <span className={styles.space}>{title}</span>
        </div>

        <nav className={styles.nav} aria-label={title}>
          {links.map((link) => {
            const active = link.href === activeHref;

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                onClick={() => setOpen(false)}
              >
                <span>{link.label}</span>
                {link.badge ? <span className={styles.badge}>{link.badge}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <Link href="/" className={styles.footLink}>
            Voir la boutique
          </Link>
          <button type="button" onClick={logout} className={styles.footLink}>
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* Voile de fermeture sur mobile, à l'ouverture du menu. */}
      <button
        type="button"
        className={styles.scrim}
        data-open={open || undefined}
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.burger}
            aria-label="Ouvrir le menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className={styles.topbarTitle}>{title}</span>
        </header>

        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

/** En-tête de page, avec une action facultative à droite. */
export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Tuile de chiffre. Le libellé passe avant la valeur pour rester lisible. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      {title || action ? (
        <div className={styles.panelHead}>
          {title ? <h2 className={styles.panelTitle}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * État vide.
 *
 * Il dit ce qu'il faut faire, pas seulement qu'il n'y a rien : un écran vide
 * sans issue laisse l'utilisateur chercher le bouton.
 */
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
      {action}
    </div>
  );
}

export { styles as workspaceStyles };
