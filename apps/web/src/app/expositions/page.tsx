import type { Metadata } from "next";
import Link from "next/link";

import { fetchExhibitions } from "@/lib/exhibitions";

import { ExhibitionCardView } from "./ExhibitionCardView";
import styles from "./expositions.module.css";

export const metadata: Metadata = {
  title: "Expositions · Ojà",
  description:
    "Expositions d’art et de design africains, sur place et en ligne. Visitez-les d’où vous êtes et achetez les œuvres exposées.",
};

/**
 * Rubrique Expositions (cahier des évolutions, § 10).
 *
 * À venir, en cours, terminées encore consultables ; gratuites ou payantes.
 * Les expositions mises en avant par l'équipe passent en tête. Les filtres
 * vivent dans l'URL, pour qu'une sélection se partage.
 */

const WHEN = [
  { value: "", label: "Toutes" },
  { value: "current", label: "En cours" },
  { value: "upcoming", label: "À venir" },
  { value: "past", label: "Terminées" },
];

const ACCESS = [
  { value: "", label: "Tous les accès" },
  { value: "free", label: "Gratuites" },
  { value: "paid", label: "Payantes" },
];

export default async function ExhibitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ quand?: string; acces?: string }>;
}) {
  const { quand, acces } = await searchParams;
  const when = WHEN.some((item) => item.value === quand) ? quand : "";
  const access = ACCESS.some((item) => item.value === acces) ? acces : "";

  const exhibitions = await fetchExhibitions({ when, access });

  const href = (next: { quand?: string; acces?: string }) => {
    const query = new URLSearchParams({
      ...(when ? { quand: when } : {}),
      ...(access ? { acces: access } : {}),
      ...next,
    });
    for (const [key, value] of [...query.entries()]) if (!value) query.delete(key);
    const suffix = query.toString();
    return `/expositions${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Expositions</p>
          <h1 className={styles.title}>Voir les œuvres, d’où que vous soyez</h1>
          <p className={styles.lead}>
            Des expositions sur place et en ligne, montées par les créateurs et les organisateurs
            d’Ojà. Les œuvres en vente s’achètent depuis la galerie, et se livrent chez vous.
          </p>
          <Link href="/expositions/proposer" className={styles.heroLink}>
            Proposer une exposition
          </Link>
        </div>
      </header>

      <section className={styles.section}>
        <nav className={styles.filters} aria-label="Filtrer les expositions">
          {WHEN.map((item) => (
            <Link
              key={item.value || "all"}
              href={href({ quand: item.value })}
              className={when === item.value ? styles.filterActive : styles.filter}
            >
              {item.label}
            </Link>
          ))}
          <span className={styles.separator} aria-hidden="true" />
          {ACCESS.map((item) => (
            <Link
              key={item.value || "all-access"}
              href={href({ acces: item.value })}
              className={access === item.value ? styles.filterActive : styles.filter}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {exhibitions.length > 0 ? (
          <div className={styles.grid}>
            {exhibitions.map((exhibition) => (
              <ExhibitionCardView key={exhibition.id} exhibition={exhibition} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            Aucune exposition ne correspond pour le moment.{" "}
            <Link href="/expositions/proposer">Proposez la vôtre.</Link>
          </p>
        )}
      </section>
    </main>
  );
}
