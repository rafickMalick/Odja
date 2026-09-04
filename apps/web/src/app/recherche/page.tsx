import Link from "next/link";

import { CatalogCard } from "@/components/CatalogCard";
import { fetchCategories, fetchProducts } from "@/lib/catalog";

import { SearchBar } from "./SearchBar";
import styles from "./page.module.css";

/**
 * Recherche.
 *
 * La recherche est faite par PostgreSQL : plein texte français, insensible aux
 * accents, avec un classement par pertinence. « Sènou » et « Senou » ramènent
 * la même chose, ce qu'un filtre écrit en JavaScript ne garantissait pas.
 */
export default async function RecherchePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categorie?: string }>;
}) {
  const { q = "", categorie = "" } = await searchParams;

  const [categories, page] = await Promise.all([
    fetchCategories(),
    fetchProducts({ q: q || undefined, category: categorie || undefined, limit: 48 }),
  ]);

  const results = page.items;
  const categoryName = categories.find((category) => category.slug === categorie)?.name;

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.title}>Rechercher</h1>
          <SearchBar
            initialQuery={q}
            categories={categories.map((category) => ({
              slug: category.slug,
              name: category.name,
            }))}
            activeCategory={categorie}
          />
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.count} aria-live="polite">
          <strong>{results.length}</strong> résultat{results.length > 1 ? "s" : ""}
          {q ? ` pour « ${q} »` : ""}
          {categoryName ? ` dans « ${categoryName} »` : ""}
        </p>

        {results.length > 0 ? (
          <div className={styles.grid}>
            {results.map((product) => (
              <CatalogCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Aucun résultat</p>
            <p className={styles.emptyText}>
              Aucune pièce ne correspond à cette recherche. Essayez un terme plus
              large, ou parcourez le catalogue.
            </p>
            <div className={styles.suggestions}>
              {categories
                .filter((category) => category.productCount > 0)
                .slice(0, 5)
                .map((category) => (
                  <Link
                    key={category.slug}
                    href={`/recherche?categorie=${category.slug}`}
                    className={styles.pill}
                  >
                    {category.name}
                  </Link>
                ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
