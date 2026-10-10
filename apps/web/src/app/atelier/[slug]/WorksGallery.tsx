"use client";

import type { DisplayAvailability, MakerWork } from "@oja/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AVAILABILITY_LABELS } from "@/lib/creators";
import { formatFcfa } from "@/lib/format";

import styles from "./page.module.css";

type Filter = "ALL" | "FOR_SALE" | "SOLD" | "PORTFOLIO";

const FILTERS: { value: Filter; label: string; matches: (state: DisplayAvailability) => boolean }[] = [
  { value: "ALL", label: "Tout", matches: () => true },
  {
    value: "FOR_SALE",
    label: "À vendre",
    matches: (state) => state === "AVAILABLE" || state === "MADE_TO_ORDER",
  },
  { value: "SOLD", label: "Vendues", matches: (state) => state === "SOLD" || state === "UNAVAILABLE" },
  { value: "PORTFOLIO", label: "Portfolio", matches: (state) => state === "PORTFOLIO" },
];

/**
 * Galerie d'un atelier, filtrable.
 *
 * Les filtres vides ne s'affichent pas : un onglet « Portfolio » qui mène à
 * une grille vide fait croire à une panne.
 */
export function WorksGallery({ works }: { works: MakerWork[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const available = useMemo(
    () => FILTERS.filter((item) => item.value === "ALL" || works.some((work) => item.matches(work.availability))),
    [works],
  );
  const active = FILTERS.find((item) => item.value === filter) ?? FILTERS[0]!;
  const shown = works.filter((work) => active.matches(work.availability));

  if (works.length === 0) {
    return <p className={styles.empty}>Cet atelier n&apos;a encore rien publié.</p>;
  }

  return (
    <>
      {available.length > 2 ? (
        <div className={styles.filters} role="tablist" aria-label="Filtrer les réalisations">
          {available.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              className={filter === item.value ? styles.filterActive : styles.filter}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <ul className={styles.grid}>
        {shown.map((work) => (
          <li key={work.id}>
            <Link href={`/produit/${work.slug}`} className={styles.work}>
              <span className={styles.workImage}>
                {work.imageUrl ? <img src={work.imageUrl} alt="" /> : null}
                <span
                  className={`${styles.state} ${
                    work.availability === "AVAILABLE" || work.availability === "MADE_TO_ORDER"
                      ? styles.stateOpen
                      : ""
                  }`}
                >
                  {AVAILABILITY_LABELS[work.availability]}
                </span>
              </span>
              <span className={styles.workName}>{work.name}</span>
              <span className={styles.workMeta}>
                {work.category}
                {work.material ? ` · ${work.material}` : ""}
              </span>
              {work.finalPriceXof !== null && work.availability !== "SOLD" ? (
                <span className={styles.workPrice}>{formatFcfa(work.finalPriceXof)}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
