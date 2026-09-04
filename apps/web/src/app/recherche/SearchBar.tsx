"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./page.module.css";

/**
 * Barre de recherche.
 *
 * Seule cette partie est interactive : la recherche elle-même est faite par
 * PostgreSQL côté serveur, avec le même traitement des accents que l'API
 * applique partout. Filtrer côté navigateur donnerait des résultats
 * différents de ceux du catalogue, sur les mêmes mots.
 */
export function SearchBar({
  initialQuery,
  categories,
  activeCategory,
}: {
  initialQuery: string;
  categories: { slug: string; name: string }[];
  activeCategory: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  const go = (nextQuery: string, nextCategory: string) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextCategory) params.set("categorie", nextCategory);
    const suffix = params.toString();
    router.push(suffix ? `/recherche?${suffix}` : "/recherche");
  };

  return (
    <>
      <form
        className={styles.searchBar}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go(query, activeCategory);
        }}
      >
        <img src="/images/icon-search.svg" alt="" className={styles.searchIcon} />
        <label htmlFor="search-query" className="srOnly">
          Rechercher une pièce, un atelier ou une matière
        </label>
        <input
          id="search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une pièce, un atelier, une matière…"
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setQuery("");
              go("", activeCategory);
            }}
          >
            Effacer
          </button>
        ) : null}
      </form>

      <div className={styles.filters}>
        <button
          type="button"
          onClick={() => go(query, "")}
          aria-pressed={activeCategory === ""}
          className={`${styles.pill} ${activeCategory === "" ? styles.pillActive : ""}`}
        >
          Toutes
        </button>
        {categories.map((category) => (
          <button
            key={category.slug}
            type="button"
            onClick={() => go(query, category.slug)}
            aria-pressed={activeCategory === category.slug}
            className={`${styles.pill} ${
              activeCategory === category.slug ? styles.pillActive : ""
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>
    </>
  );
}
