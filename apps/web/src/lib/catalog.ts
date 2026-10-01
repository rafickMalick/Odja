import type { Page, PublicCategory, PublicMaker, PublicProduct } from '@oja/contracts';

import { apiFetch, apiFetchOrNull } from './api';

/**
 * Lecture du catalogue.
 *
 * Remplace l'ancien module de données statiques. Les fiches viennent
 * désormais de l'API : ce sont les pièces que des artisans ont réellement
 * publiées et que l'administration a validées.
 *
 * Le catalogue est mis en cache 60 secondes côté serveur  il change au
 * rythme des mises en vente, pas à celui des requêtes.
 */

const CATALOG_TTL = 60;

export interface CatalogFilters {
  q?: string | undefined;
  category?: string | undefined;
  maker?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
}

export async function fetchProducts(filters: CatalogFilters = {}): Promise<Page<PublicProduct>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }

  const suffix = query.toString();
  const page = await apiFetchOrNull<Page<PublicProduct>>(
    `/catalog/products${suffix ? `?${suffix}` : ''}`,
    { revalidate: CATALOG_TTL },
  );

  // Un catalogue injoignable donne une grille vide, pas une page en erreur.
  return page ?? { items: [], nextCursor: null };
}

export async function fetchProduct(slug: string): Promise<PublicProduct | null> {
  return apiFetchOrNull<PublicProduct>(`/catalog/products/${encodeURIComponent(slug)}`, {
    revalidate: CATALOG_TTL,
  });
}

export async function fetchCategories(): Promise<PublicCategory[]> {
  const categories = await apiFetchOrNull<PublicCategory[]>('/catalog/categories', {
    revalidate: CATALOG_TTL,
  });
  return categories ?? [];
}

export async function fetchMaker(slug: string): Promise<PublicMaker | null> {
  return apiFetchOrNull<PublicMaker>(`/makers/${encodeURIComponent(slug)}`, {
    revalidate: CATALOG_TTL,
  });
}

export interface CatalogFacets {
  categories: { slug: string; name: string; count: number }[];
  cities: { name: string; count: number }[];
  priceRange: { min: number; max: number } | null;
}

export async function fetchFacets(): Promise<CatalogFacets> {
  const facets = await apiFetchOrNull<CatalogFacets>('/catalog/facets', {
    revalidate: CATALOG_TTL,
  });
  return facets ?? { categories: [], cities: [], priceRange: null };
}

/**
 * Chiffres de la page d'accueil.
 *
 * Ils remplacent les valeurs d'exemple qui y figuraient. Tant que la place de
 * marché n'a qu'une poignée d'ateliers, mieux vaut afficher la vérité que
 * gonfler : « 3 ateliers partenaires » est plus crédible qu'un « 120+ » que
 * personne ne vérifie.
 */
export async function fetchMarketplaceStats(): Promise<{
  makers: number;
  products: number;
  cities: number;
}> {
  const facets = await fetchFacets();

  return {
    makers: 0, // renseigné par l'agrégat ci-dessous
    products: facets.categories.reduce((total, category) => total + category.count, 0),
    cities: facets.cities.length,
  };
}

/** Cherche dans le catalogue, en respectant le contrat de l'API. */
export async function searchProducts(term: string): Promise<PublicProduct[]> {
  if (!term.trim()) {
    const page = await fetchProducts({ limit: 24 });
    return page.items;
  }
  const page = await fetchProducts({ q: term, limit: 48 });
  return page.items;
}

/** Ré-export pour les composants qui n'ont besoin que du type. */
export type { PublicProduct, PublicCategory, PublicMaker };

/** Le prix affiché au client est toujours le prix final, commission comprise. */
export function displayPrice(product: PublicProduct): number {
  return product.finalPriceXof;
}

export async function requireProduct(slug: string): Promise<PublicProduct> {
  const product = await fetchProduct(slug);
  if (!product) throw new Error(`Produit introuvable : ${slug}`);
  return product;
}

export { apiFetch };
