import type { MakerCard } from "@oja/contracts";
import Link from "next/link";

import { CREATOR_KIND_SHORT } from "@/lib/creators";

import styles from "./CreatorCard.module.css";

/** Carte d'un créateur : annuaire et accueil. */
export function CreatorCard({ maker }: { maker: MakerCard }) {
  return (
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
      <span className={styles.body}>
        <span className={styles.kind}>
          {CREATOR_KIND_SHORT[maker.creatorKind]}
          {maker.badge ? <span className={styles.badge}>{maker.badge.name}</span> : null}
        </span>
        <span className={styles.name}>{maker.shopName}</span>
        <span className={styles.meta}>{[maker.activityField, maker.city].filter(Boolean).join(" · ")}</span>
        {maker.specialties.length > 0 ? (
          <span className={styles.meta}>{maker.specialties.slice(0, 3).join(" · ")}</span>
        ) : null}
        <span className={styles.pieces}>
          {maker.productCount} pièce{maker.productCount > 1 ? "s" : ""} en vente
        </span>
      </span>
    </Link>
  );
}
