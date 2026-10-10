import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchMaker } from "@/lib/catalog";
import { CREATOR_KIND_LABELS, fetchMakerWorks } from "@/lib/creators";
import { formatNumber } from "@/lib/format";

import { WorksGallery } from "./WorksGallery";
import styles from "./page.module.css";

/**
 * Profil public d'un créateur (cahier des évolutions, § 2).
 *
 * Bannière, identité, présentation, localisation, puis la galerie complète :
 * pièces à vendre, pièces vendues et réalisations de portfolio. On n'y voit
 * que les **informations publiques** — ni téléphone, ni e-mail, ni adresse
 * exacte. La règle est tenue côté API : la route publique ne renvoie tout
 * simplement pas ces champs.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const maker = await fetchMaker(slug);
  if (!maker) return {};
  return {
    title: `${maker.shopName} · Ojà`,
    description:
      maker.description?.slice(0, 160) ??
      `${CREATOR_KIND_LABELS[maker.creatorKind]} à ${maker.city}, sur Ojà.`,
  };
}

export default async function AtelierPage({ params }: Params) {
  const { slug } = await params;

  const [maker, works] = await Promise.all([fetchMaker(slug), fetchMakerWorks(slug)]);
  if (!maker) notFound();

  /* Du plus précis au plus large : « Haie Vive, Cotonou, Littoral, Bénin ».
     Le quartier n'apparaît que si le créateur a choisi de le montrer. */
  const place = [maker.publicArea, maker.city, maker.region, maker.country]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  const initials = maker.shopName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <main className={styles.page}>
      <div
        className={styles.banner}
        style={maker.coverUrl ? { backgroundImage: `url(${maker.coverUrl})` } : undefined}
        role="img"
        aria-label={maker.coverUrl ? `Bannière de ${maker.shopName}` : undefined}
      />

      <header className={styles.identity}>
        <div className={styles.identityInner}>
          <div className={styles.logo}>
            {maker.logoUrl ? (
              <img src={maker.logoUrl} alt={`Logo de ${maker.shopName}`} />
            ) : (
              <span aria-hidden="true">{initials}</span>
            )}
          </div>

          <div className={styles.identityText}>
            <p className={styles.eyebrow}>
              {CREATOR_KIND_LABELS[maker.creatorKind]}
              {maker.activityField ? ` · ${maker.activityField}` : ""}
            </p>
            <h1 className={styles.title}>
              {maker.shopName}
              {maker.badge ? (
                <span
                  className={styles.badge}
                  title="Formule de visibilité commerciale. Ce n’est pas une certification de qualité."
                >
                  {maker.badge.name}
                </span>
              ) : null}
            </h1>
            <p className={styles.place}>{place}</p>
            {maker.ratingCount > 0 ? (
              <p className={styles.rating}>
                {formatNumber(maker.ratingAvg, 1)} / 5 · {maker.ratingCount} avis
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {maker.description || maker.services || maker.specialties.length > 0 || maker.techniques.length > 0 ? (
        <section className={styles.about}>
          <div className={styles.aboutText}>
            {maker.description ? (
              <>
                <h2 className={styles.heading}>Présentation</h2>
                <p className={styles.lead}>{maker.description}</p>
              </>
            ) : null}
            {maker.services ? (
              <>
                <h3 className={styles.subheading}>Services proposés</h3>
                <p className={styles.body}>{maker.services}</p>
              </>
            ) : null}
          </div>

          <aside className={styles.aboutAside}>
            {maker.specialties.length > 0 ? (
              <div>
                <h3 className={styles.subheading}>Spécialités</h3>
                <ul className={styles.tags}>
                  {maker.specialties.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {maker.techniques.length > 0 ? (
              <div>
                <h3 className={styles.subheading}>Matériaux et techniques</h3>
                <ul className={styles.tags}>
                  {maker.techniques.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.heading}>Réalisations</h2>
        <WorksGallery works={works} />
      </section>
    </main>
  );
}
