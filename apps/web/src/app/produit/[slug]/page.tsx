import { notFound } from "next/navigation";

import { fetchProduct, fetchProductReviews } from "@/lib/catalog";

import { ProductDetail } from "./ProductDetail";
import { ProductReviewsSection } from "./ProductReviews";

/* Plus de `generateStaticParams` : le catalogue est vivant, les ateliers
   publient et retirent des pièces sans redéploiement. La page est rendue à la
   demande et mise en cache 60 secondes par la couche d'accès à l'API. */

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [product, reviews] = await Promise.all([fetchProduct(slug), fetchProductReviews(slug)]);

  if (!product) notFound();

  return (
    <ProductDetail product={product}>
      {reviews ? <ProductReviewsSection reviews={reviews} /> : null}
    </ProductDetail>
  );
}
