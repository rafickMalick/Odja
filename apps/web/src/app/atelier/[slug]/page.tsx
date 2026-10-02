import { notFound } from "next/navigation";

import { CatalogCard } from "@/components/CatalogCard";
import { fetchMaker, fetchProducts } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";

import styles from "./page.module.css";

/**
 * Vitrine d'un atelier.
 *
 * On n'y voit que les **informations publiques** : nom, description, ville,
 * pièces en vente. Ni téléphone, ni e-mail, ni adresse  c'est la règle métier
 * qui fonde la place de marché, et elle est tenue côté API : la route publique
 * ne renvoie tout simplement pas ces champs.
 */
export default async function AtelierPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const maker = await fetchMaker(slug);
  if (!maker) notFound();

  const page = await fetchProducts({ maker: slug, limit: 48 });

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Atelier partenaire</p>
          <h1 className={styles.title}>{maker.shopName}</h1>
          <p className={styles.place}>
            {maker.city}, {maker.country}
          </p>
          {maker.description ? (
            <p className={styles.lead}>{maker.description}</p>
          ) : null}
          <p className={styles.count}>
            {maker.productCount} pièce{maker.productCount > 1 ? "s" : ""} en vente
            {maker.ratingCount > 0
              ? ` · ${formatNumber(maker.ratingAvg, 1)} / 5 sur ${maker.ratingCount} avis`
              : ""}
          </p>
        </div>
      </header>

      <section className={styles.section}>
        {page.items.length > 0 ? (
          <div className={styles.grid}>
            {page.items.map((product) => (
              <CatalogCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            Cet atelier n&apos;a aucune pièce en vente pour le moment.
          </p>
        )}
      </section>
    </main>
  );
}
