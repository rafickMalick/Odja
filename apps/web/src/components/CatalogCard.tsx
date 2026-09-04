"use client";

import type { PublicProduct } from "@oja/contracts";
import Link from "next/link";
import { useState } from "react";

import { useCart } from "@/lib/cart";
import { formatCompactFcfa } from "@/lib/format";

import styles from "./CatalogCard.module.css";

export function CatalogCard({ product }: { product: PublicProduct }) {
  const { add } = useCart();
  const [adding, setAdding] = useState(false);
  const href = `/produit/${product.slug}`;
  const image = product.images[0]?.url;

  const handleAdd = async () => {
    setAdding(true);
    try {
      await add(product.id);
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className={styles.root}>
      <Link href={href} className={styles.imageLink}>
        {image ? <img src={image} alt="" className={styles.image} /> : null}
        <span className={styles.tag}>{product.category.name}</span>
      </Link>

      <div className={styles.info}>
        <div className={styles.text}>
          <Link href={href} className={styles.name}>
            {product.name}
          </Link>

          <p className={styles.meta}>
            <span className={styles.metaPair}>
              <span>Atelier :</span>
              <span>{product.maker.shopName}</span>
            </span>
            {/* La puce vit dans la seconde paire : au repli de la ligne elle
                suit « Matière » au lieu de rester orpheline en bout de ligne. */}
            <span className={styles.metaPair}>
              <span className={styles.dot} aria-hidden="true">
                •
              </span>
              <span>Matière :</span>
              <span>{product.material ?? "—"}</span>
            </span>
          </p>

          {/* Le prix affiché est le prix final, commission comprise : c'est
              celui que le client paiera. Le détail figure sur la fiche. */}
          <p className={styles.price}>{formatCompactFcfa(product.finalPriceXof)}</p>
        </div>

        <button
          type="button"
          className={styles.addButton}
          onClick={handleAdd}
          disabled={adding || !product.inStock}
          aria-label={
            product.inStock
              ? `Ajouter ${product.name} au panier`
              : `${product.name} est en rupture`
          }
        >
          <img src="/images/icon-basket.svg" alt="" className={styles.addIcon} />
        </button>
      </div>
    </article>
  );
}
