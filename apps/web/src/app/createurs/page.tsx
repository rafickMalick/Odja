import type { CreatorKind } from "@oja/contracts";
import type { Metadata } from "next";
import Link from "next/link";

import { apiFetchOrNull } from "@/lib/api";
import { CREATOR_KIND_LABELS, CREATOR_KIND_SHORT, fetchDirectory } from "@/lib/creators";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Créateurs · Ojà",
  description:
    "Artisans, designers et studios créatifs d’Afrique de l’Ouest : découvrez leurs ateliers et leurs réalisations.",
};

/**
 * Annuaire des créateurs (cahier des évolutions, § 2.2 D).
 *
 * Composant serveur, filtres dans l'URL : une recherche « designers à
 * Cotonou » se partage et survit à un rechargement. Les ateliers Premium
 * passent en tête, tous les autres restent listés.
 */

type SearchParams = { q?: string; statut?: string; ville?: string; suite?: string };

const KINDS = Object.keys(CREATOR_KIND_LABELS) as CreatorKind[];

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const kind = KINDS.includes(params.statut as CreatorKind) ? params.statut : undefined;

  const [page, cities] = await Promise.all([
    fetchDirectory({ q: params.q, kind, city: params.ville, cursor: params.suite }),
    apiFetchOrNull<{ id: string; name: string }[]>("/geo/cities", { revalidate: 3600 }),
  ]);

  const nextHref = page.nextCursor
    ? `/createurs?${new URLSearchParams({
        ...(params.q ? { q: params.q } : {}),
        ...(kind ? { statut: kind } : {}),
        ...(params.ville ? { ville: params.ville } : {}),
        suite: page.nextCursor,
      }).toString()}`
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Annuaire</p>
          <h1 className={styles.title}>Les créateurs d’Ojà</h1>
          <p className={styles.lead}>
            Ateliers, designers et studios : découvrez qui fabrique, où, et avec quels savoir-faire.
          </p>

          <form className={styles.filters} action="/createurs" method="get">
            <label className={styles.field}>
              <span>Recherche</span>
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Nom, domaine, technique…"
              />
            </label>
            <label className={styles.field}>
              <span>Statut</span>
              <select name="statut" defaultValue={kind ?? ""}>
                <option value="">Tous</option>
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {CREATOR_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Ville</span>
              <select name="ville" defaultValue={params.ville ?? ""}>
                <option value="">Toutes</option>
                {(cities ?? []).map((city) => (
                  <option key={city.id} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={styles.submit}>
              Filtrer
            </button>
          </form>
        </div>
      </header>

      <section className={styles.section}>
        {page.items.length > 0 ? (
          <>
            <p className={styles.count}>
              {page.total ?? page.items.length} créateur{(page.total ?? page.items.length) > 1 ? "s" : ""}
            </p>
            <ul className={styles.grid}>
              {page.items.map((maker) => (
                <li key={maker.id}>
                  <Link href={`/atelier/${maker.slug}`} className={styles.card}>
                    <span
                      className={styles.cover}
                      style={maker.coverUrl ? { backgroundImage: `url(${maker.coverUrl})` } : undefined}
                    />
                    <span className={styles.logo}>
                      {maker.logoUrl ? (
                        <img src={maker.logoUrl} alt="" />
                      ) : (
                        <span aria-hidden="true">{maker.shopName.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.kind}>
                        {CREATOR_KIND_SHORT[maker.creatorKind]}
                        {maker.badge ? <span className={styles.badge}>{maker.badge.name}</span> : null}
                      </span>
                      <span className={styles.name}>{maker.shopName}</span>
                      <span className={styles.meta}>
                        {[maker.activityField, maker.city].filter(Boolean).join(" · ")}
                      </span>
                      {maker.specialties.length > 0 ? (
                        <span className={styles.specialties}>
                          {maker.specialties.slice(0, 3).join(" · ")}
                        </span>
                      ) : null}
                      <span className={styles.pieces}>
                        {maker.productCount} pièce{maker.productCount > 1 ? "s" : ""} en vente
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {nextHref ? (
              <Link href={nextHref} className={styles.more}>
                Voir plus de créateurs
              </Link>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>
            Aucun créateur ne correspond à cette recherche.{" "}
            <Link href="/createurs">Voir tous les créateurs</Link>
          </p>
        )}
      </section>
    </main>
  );
}
