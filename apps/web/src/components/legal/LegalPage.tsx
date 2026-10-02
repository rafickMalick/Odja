import Link from "next/link";
import type { ReactNode } from "react";

import { LEGAL } from "@/lib/legal";

import styles from "./legal.module.css";

/** Les cinq documents légaux, pour les liens croisés et le pied de page. */
export const LEGAL_PAGES = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/confidentialite", label: "Politique de confidentialité" },
  { href: "/cookies", label: "Politique de cookies" },
  { href: "/conditions-generales", label: "Conditions générales d’utilisation" },
  { href: "/conditions-de-vente", label: "Conditions de vente" },
] as const;

/** Gabarit commun des pages légales. */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Informations légales</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.updated}>Version du {LEGAL.updatedAt}</p>
        </div>
      </div>

      <article className={styles.body}>
        {intro ? <div className={styles.notice}>{intro}</div> : null}
        {children}

        <h2>Voir aussi</h2>
        <ul>
          {LEGAL_PAGES.filter((page) => page.label !== title).map((page) => (
            <li key={page.href}>
              <Link href={page.href}>{page.label}</Link>
            </li>
          ))}
        </ul>
      </article>
    </main>
  );
}

/**
 * Une information légale : sa valeur si elle est renseignée (src/lib/legal.ts),
 * sinon la valeur de repli, sinon rien. Aucune mention provisoire n'apparaît
 * sur le site.
 */
export function Legal({ value, fallback }: { value: string | null; fallback?: string }) {
  const shown = value ?? fallback;
  return shown ? <>{shown}</> : null;
}
