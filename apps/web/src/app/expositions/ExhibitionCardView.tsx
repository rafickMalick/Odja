import type { ExhibitionCard } from "@oja/contracts";
import Link from "next/link";

import { FORMAT_LABELS, PERIOD_LABELS, accessLabel, dateRange } from "@/lib/exhibitions";

import styles from "./expositions.module.css";

/** Carte d'une exposition, partagée par la rubrique et l'accueil. */
export function ExhibitionCardView({ exhibition }: { exhibition: ExhibitionCard }) {
  return (
    <Link href={`/expositions/${exhibition.slug}`} className={styles.card}>
      <span
        className={styles.cover}
        style={exhibition.coverUrl ? { backgroundImage: `url(${exhibition.coverUrl})` } : undefined}
      >
        <span className={styles.period}>{PERIOD_LABELS[exhibition.period]}</span>
        {exhibition.isFeatured ? <span className={styles.featured}>À la une</span> : null}
      </span>
      <span className={styles.cardBody}>
        <span className={styles.meta}>
          {FORMAT_LABELS[exhibition.format]} · {exhibition.city}
        </span>
        <span className={styles.cardTitle}>{exhibition.title}</span>
        <span className={styles.meta}>par {exhibition.organizerName}</span>
        <span className={styles.dates}>{dateRange(exhibition.startsAt, exhibition.endsAt)}</span>
        <span className={styles.footer}>
          <span>{accessLabel(exhibition)}</span>
          <span>
            {exhibition.workCount} œuvre{exhibition.workCount > 1 ? "s" : ""}
          </span>
        </span>
      </span>
    </Link>
  );
}
