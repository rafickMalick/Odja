import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchExhibition, FORMAT_LABELS, PERIOD_LABELS, accessLabel, dateRange } from "@/lib/exhibitions";

import styles from "../expositions.module.css";
import { ExhibitionGallery } from "./ExhibitionGallery";

/**
 * Page publique d'une exposition (cahier des évolutions, § 7).
 *
 * L'en-tête, la présentation et les informations pratiques se rendent côté
 * serveur. La galerie, elle, se charge dans le navigateur : c'est là que la
 * session du visiteur accompagne la requête, et qu'un billet ou une
 * inscription ouvrent les contenus réservés.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const exhibition = await fetchExhibition(slug);
  if (!exhibition) return {};
  return {
    title: `${exhibition.title} · Expositions Ojà`,
    description: exhibition.summary.slice(0, 160),
    openGraph: exhibition.coverUrl ? { images: [exhibition.coverUrl] } : undefined,
  };
}

export default async function ExhibitionPage({ params }: Params) {
  const { slug } = await params;
  const exhibition = await fetchExhibition(slug);
  if (!exhibition) notFound();

  const onsite = exhibition.format !== "ONLINE";
  const remote = exhibition.format !== "PHYSICAL";

  return (
    <main className={styles.page}>
      <header
        className={styles.banner}
        style={
          exhibition.coverUrl
            ? {
                backgroundImage: `linear-gradient(180deg, rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.75)), url(${exhibition.coverUrl})`,
              }
            : undefined
        }
      >
        <div className={styles.bannerInner}>
          <div className={styles.chips}>
            <span className={styles.chip}>{PERIOD_LABELS[exhibition.period]}</span>
            <span className={styles.chip}>{FORMAT_LABELS[exhibition.format]}</span>
            <span className={styles.chip}>{accessLabel(exhibition)}</span>
          </div>
          <h1 className={styles.title}>{exhibition.title}</h1>
          <p className={styles.organizer}>
            Organisée par{" "}
            {exhibition.organizer.makerSlug ? (
              <Link href={`/atelier/${exhibition.organizer.makerSlug}`}>{exhibition.organizerName}</Link>
            ) : (
              exhibition.organizerName
            )}{" "}
            · {dateRange(exhibition.startsAt, exhibition.endsAt)}
          </p>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.prose}>
          <h2 className={styles.heading}>L’exposition</h2>
          <p className={styles.body}>{exhibition.summary}</p>
          {exhibition.objective ? (
            <>
              <h3 className={styles.subheading}>Intention</h3>
              <p className={styles.body}>{exhibition.objective}</p>
            </>
          ) : null}
          {onsite && exhibition.venueDescription ? (
            <>
              <h3 className={styles.subheading}>Le lieu</h3>
              <p className={styles.body}>{exhibition.venueDescription}</p>
            </>
          ) : null}
          {exhibition.venueImageUrls.length > 0 ? (
            <div className={styles.venuePhotos}>
              {exhibition.venueImageUrls.map((url) => (
                <img key={url} src={url} alt={`Le lieu de l’exposition ${exhibition.title}`} />
              ))}
            </div>
          ) : null}
        </section>

        <aside className={styles.aside}>
          <dl className={styles.facts}>
            <div>
              <dt>Dates</dt>
              <dd>{dateRange(exhibition.startsAt, exhibition.endsAt)}</dd>
            </div>
            {exhibition.openingHours ? (
              <div>
                <dt>Horaires</dt>
                <dd>{exhibition.openingHours}</dd>
              </div>
            ) : null}
            {onsite && exhibition.venueName ? (
              <div>
                <dt>Sur place</dt>
                <dd>
                  {exhibition.venueName}
                  {exhibition.venueAddress ? `\n${exhibition.venueAddress}` : ""}
                  {`\n${exhibition.city}, ${exhibition.country}`}
                </dd>
              </div>
            ) : null}
            {onsite && exhibition.onsiteInfo ? (
              <div>
                <dt>Pour les visiteurs sur place</dt>
                <dd>{exhibition.onsiteInfo}</dd>
              </div>
            ) : null}
            {remote ? (
              <div>
                <dt>À distance</dt>
                <dd>
                  {exhibition.remoteInfo ??
                    "La galerie se visite en ligne, depuis le Bénin comme depuis l’étranger."}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Accès</dt>
              <dd>{accessLabel(exhibition)}</dd>
            </div>
            {exhibition.discipline ? (
              <div>
                <dt>Discipline</dt>
                <dd>{exhibition.discipline}</dd>
              </div>
            ) : null}
          </dl>
          <p className={styles.notice}>
            Les œuvres en vente s’achètent sans venir sur place : paiement sur Ojà, livraison selon
            les zones desservies.
          </p>
        </aside>
      </div>

      <ExhibitionGallery slug={exhibition.slug} initial={exhibition} />
    </main>
  );
}
