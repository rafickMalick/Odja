import Link from "next/link";

import { CatalogCard } from "@/components/CatalogCard";
import { fetchCategories, fetchProducts } from "@/lib/catalog";

import { SearchInput } from "./SearchInput";
import styles from "./page.module.css";

/**
 * Catalogue.
 *
 * Composant serveur : les fiches viennent de l'API, plus d'un fichier
 * statique. Le filtre par catégorie et la recherche passent tous deux par
 * l'URL  une sélection se partage, se met en favori et survit à un
 * rechargement, ce qu'un état React ne permettait pas.
 *
 * La recherche vit ici plutôt que derrière une icône de l'en-tête : c'est sur
 * cette page qu'on cherche une pièce, pas ailleurs.
 */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string; q?: string }>;
}) {
  const { categorie, q } = await searchParams;

  const [categories, page] = await Promise.all([
    fetchCategories(),
    fetchProducts({ category: categorie, q: q || undefined, limit: 48 }),
  ]);

  const active = categorie ?? "";

  return (
    <main className={styles.page}>
      <div className={styles.section}>
        <div className={styles.searchRow}>
          <SearchInput initialQuery={q ?? ""} activeCategory={active} />
        </div>

        <div className={styles.container}>
          <aside className={styles.aside}>
            <h2 className={styles.asideTitle}>Catégories</h2>
            <ul className={styles.categoryList}>
              <li className={styles.categoryItem}>
                <Link
                  href={q ? `/catalogue?q=${encodeURIComponent(q)}` : "/catalogue"}
                  aria-current={active === "" ? "page" : undefined}
                  className={`${styles.categoryLink} ${
                    active === "" ? styles.categoryLinkActive : ""
                  }`}
                >
                  Toutes
                </Link>
              </li>
              {categories.map((category) => {
                const params = new URLSearchParams({ categorie: category.slug });
                if (q) params.set("q", q);
                return (
                  <li key={category.slug} className={styles.categoryItem}>
                    <Link
                      href={`/catalogue?${params.toString()}`}
                      aria-current={active === category.slug ? "page" : undefined}
                      className={`${styles.categoryLink} ${
                        active === category.slug ? styles.categoryLinkActive : ""
                      }`}
                    >
                      {category.name}
                      {category.productCount > 0 ? (
                        <span className={styles.categoryCount}> ({category.productCount})</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className={styles.grid}>
            {page.items.length > 0 ? (
              page.items.map((product) => (
                <CatalogCard key={product.id} product={product} />
              ))
            ) : q ? (
              <p className={styles.empty}>
                Aucune pièce ne correspond à « {q} »
                {active ? " dans cette catégorie" : ""}. Essayez un terme plus
                large.
              </p>
            ) : (
              <p className={styles.empty}>
                {active
                  ? `Aucune pièce dans cette catégorie pour le moment.`
                  : `Le catalogue est encore vide  les premiers ateliers arrivent.`}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
