"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./page.module.css";

/**
 * Barre de recherche du catalogue.
 *
 * Seule cette partie est interactive : la recherche elle-même est faite par
 * PostgreSQL côté serveur, avec le même traitement des accents que l'API
 * applique partout. La catégorie déjà choisie est conservée dans l'URL — on
 * cherche un mot, on ne repart pas de zéro.
 */
export function SearchInput({
  initialQuery,
  activeCategory,
}: {
  initialQuery: string;
  activeCategory: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  const go = (nextQuery: string) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (activeCategory) params.set("categorie", activeCategory);
    const suffix = params.toString();
    router.push(suffix ? `/catalogue?${suffix}` : "/catalogue");
  };

  return (
    <form
      className={styles.searchBar}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        go(query);
      }}
    >
      <img src="/images/icon-search.svg" alt="" className={styles.searchIcon} />
      <label htmlFor="catalogue-search" className="srOnly">
        Rechercher une pièce, un atelier ou une matière
      </label>
      <input
        id="catalogue-search"
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
            go("");
          }}
        >
          Effacer
        </button>
      ) : null}
    </form>
  );
}
