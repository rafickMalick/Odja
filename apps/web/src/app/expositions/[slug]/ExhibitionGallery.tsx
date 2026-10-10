"use client";

import type { PublicExhibition } from "@oja/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { AVAILABILITY_LABELS } from "@/lib/creators";
import { formatFcfa } from "@/lib/format";

import styles from "../expositions.module.css";
import { AccessPanel } from "./AccessPanel";
import { BuyButton } from "./BuyButton";

/**
 * Galerie d'une exposition.
 *
 * Rechargée dans le navigateur : la session du visiteur accompagne alors la
 * requête, et l'API ouvre la galerie à qui détient un billet, une inscription
 * ou le code d'accès. Tant qu'elle reste fermée, le panneau d'accès dit quoi
 * faire.
 */
export function ExhibitionGallery({ slug, initial }: { slug: string; initial: PublicExhibition }) {
  const [exhibition, setExhibition] = useState(initial);

  const reload = useCallback(async () => {
    try {
      setExhibition(await apiFetch<PublicExhibition>(`/exhibitions/${encodeURIComponent(slug)}`));
    } catch {
      /* On garde la version rendue par le serveur. */
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className={styles.gallery} aria-labelledby="galerie">
      <h2 id="galerie" className={styles.heading}>
        Les œuvres ({exhibition.workCount})
      </h2>

      {!exhibition.unlocked || !exhibition.works ? (
        <AccessPanel exhibition={exhibition} onUnlocked={reload} />
      ) : exhibition.works.length === 0 ? (
        <p className={styles.notice}>Les œuvres seront présentées très bientôt.</p>
      ) : (
        <ul className={styles.works}>
          {exhibition.works.map((work) => (
            <li key={work.id} className={styles.work}>
              <div className={styles.workImage}>
                {work.imageUrls[0] ? <img src={work.imageUrls[0]} alt={work.title} /> : null}
              </div>
              <h3 className={styles.workTitle}>{work.title}</h3>
              <p className={styles.workMeta}>
                {work.artistName}
                {work.materials ? ` · ${work.materials}` : ""}
                {work.dimensions ? ` · ${work.dimensions}` : ""}
              </p>
              <p className={styles.workText}>{work.description}</p>
              {work.product ? (
                <div className={styles.workBuy}>
                  <span className={styles.price}>
                    {work.product.availability === "SOLD"
                      ? AVAILABILITY_LABELS.SOLD
                      : formatFcfa(work.product.finalPriceXof)}
                  </span>
                  {work.product.purchasable ? (
                    <BuyButton productId={work.product.id} />
                  ) : (
                    <Link href={`/produit/${work.product.slug}`} className={styles.notice}>
                      {AVAILABILITY_LABELS[work.product.availability]}
                    </Link>
                  )}
                </div>
              ) : (
                <p className={styles.notice}>Œuvre présentée, non proposée à la vente.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
