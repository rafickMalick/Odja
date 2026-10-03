import type { ProductReviews } from "@oja/contracts";

import { Stars, formatRating } from "@/components/Stars";

import styles from "./page.module.css";
import reviewStyles from "./reviews.module.css";

/**
 * Avis des acheteurs, sous la fiche.
 *
 * Seuls des avis vérifiés y figurent : chacun vient d'un achat réel, noté
 * après réception, et relu par l'équipe. On le dit — c'est ce qui donne du
 * poids à la note.
 */
export function ProductReviewsSection({ reviews }: { reviews: ProductReviews }) {
  return (
    <section className={styles.section} aria-labelledby="avis-titre">
      <div className={reviewStyles.wrap}>
        <h2 id="avis-titre" className={reviewStyles.title}>
          Avis des acheteurs
        </h2>

        {reviews.ratingCount === 0 ? (
          <p className={reviewStyles.muted}>
            Pas encore d&apos;avis sur cette pièce. Les avis viennent uniquement d&apos;acheteurs
            qui l&apos;ont reçue.
          </p>
        ) : (
          <>
            <p className={reviewStyles.summary}>
              <Stars value={reviews.ratingAvg} size={20} />
              <strong>{formatRating(reviews.ratingAvg)} / 5</strong>
              <span className={reviewStyles.muted}>
                {reviews.ratingCount} avis vérifié{reviews.ratingCount > 1 ? "s" : ""}
              </span>
            </p>

            <ul className={reviewStyles.list}>
              {reviews.items.map((review) => (
                <li key={review.id} className={reviewStyles.item}>
                  <p className={reviewStyles.meta}>
                    <Stars value={review.rating} />
                    <span>
                      {review.authorName} ·{" "}
                      {new Date(review.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </p>
                  {review.body ? <p className={reviewStyles.body}>{review.body}</p> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
