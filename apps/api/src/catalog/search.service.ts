import { Injectable } from '@nestjs/common';
import type { CatalogQuery, Page, PublicProduct } from '@oja/contracts';
import type { Prisma } from '@oja/db';

import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from './product.service';

/**
 * Recherche et navigation du catalogue.
 *
 * Le cahier client demande de chercher « un produit, une entreprise, une
 * catégorie ». Postgres suffit à ce volume : la colonne `searchVector` et son
 * index GIN sont déjà en place, avec `unaccent` appliqué **exactement comme le
 * front le fait côté client** — sans quoi « Sènou » et « Senou » ne
 * ramèneraient pas les mêmes résultats selon l'endroit où l'on tape.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductService,
  ) {}

  async search(query: CatalogQuery): Promise<Page<PublicProduct>> {
    const where = await this.buildWhere(query);

    /* Recherche plein texte : on récupère d'abord les identifiants classés par
       pertinence, puis on charge les fiches complètes. Deux requêtes, mais le
       classement `ts_rank` n'est pas exprimable dans le langage de Prisma. */
    if (query.q) {
      return this.fullTextSearch(query, where);
    }

    const items = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
        images: { orderBy: { position: 'asc' } },
        maker: { include: { city: true } },
      },
      orderBy: this.orderBy(query.sort),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return this.page(items, query.limit);
  }

  private async fullTextSearch(
    query: CatalogQuery,
    where: Prisma.ProductWhereInput,
  ): Promise<Page<PublicProduct>> {
    const term = query.q ?? '';

    /* `websearch_to_tsquery` accepte ce qu'un humain tape réellement —
       guillemets, `or`, `-mot` — là où `to_tsquery` lève une erreur de syntaxe
       sur une simple apostrophe. Sur une barre de recherche publique, c'est la
       différence entre un résultat vide et une erreur 500. */
    const ranked = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
        FROM products
       WHERE "searchVector" @@ websearch_to_tsquery('french', unaccent(${term}))
         AND status = 'PUBLISHED'
         AND "hiddenAt" IS NULL
         AND "deletedAt" IS NULL
         AND "isForSale"
         AND availability = 'AVAILABLE'
       ORDER BY ts_rank("searchVector", websearch_to_tsquery('french', unaccent(${term}))) DESC,
                "createdAt" DESC
       LIMIT ${query.limit + 1}
    `;

    const ids = ranked.map((row) => row.id);
    if (ids.length === 0) return { items: [], nextCursor: null };

    const items = await this.prisma.product.findMany({
      where: { ...where, id: { in: ids } },
      include: {
        category: true,
        images: { orderBy: { position: 'asc' } },
        maker: { include: { city: true } },
      },
    });

    // La base rend les fiches dans un ordre quelconque : on restitue celui du
    // classement de pertinence.
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });

    return this.page(ordered, query.limit);
  }

  /** Facettes : ce que l'on peut encore filtrer, avec le nombre de pièces. */
  async facets(): Promise<{
    categories: { slug: string; name: string; count: number }[];
    cities: { name: string; count: number }[];
    priceRange: { min: number; max: number } | null;
  }> {
    const visible: Prisma.ProductWhereInput = {
      status: 'PUBLISHED',
      hiddenAt: null,
      deletedAt: null,
      isForSale: true,
      availability: 'AVAILABLE',
    };

    const [categories, cities, aggregate] = await Promise.all([
      this.prisma.category.findMany({
        select: {
          slug: true,
          name: true,
          _count: { select: { products: { where: visible } } },
        },
        orderBy: { position: 'asc' },
      }),
      this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
        SELECT c.name, COUNT(*)::bigint AS count
          FROM products p
          JOIN maker_profiles m ON m.id = p."makerId"
          JOIN cities c ON c.id = m."cityId"
         WHERE p.status = 'PUBLISHED' AND p."hiddenAt" IS NULL AND p."deletedAt" IS NULL
           AND p."isForSale" AND p.availability = 'AVAILABLE'
         GROUP BY c.name
         ORDER BY count DESC
      `,
      this.prisma.product.aggregate({
        where: visible,
        _min: { makerPriceXof: true },
        _max: { makerPriceXof: true },
      }),
    ]);

    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        count: c._count.products,
      })),
      // COUNT renvoie un bigint, que JSON.stringify refuse de sérialiser.
      cities: cities.map((c) => ({ name: c.name, count: Number(c.count) })),
      priceRange:
        aggregate._min.makerPriceXof !== null && aggregate._max.makerPriceXof !== null
          ? { min: aggregate._min.makerPriceXof, max: aggregate._max.makerPriceXof }
          : null,
    };
  }

  private async buildWhere(query: CatalogQuery): Promise<Prisma.ProductWhereInput> {
    return {
      status: 'PUBLISHED',
      hiddenAt: null,
      deletedAt: null,
      /* Le catalogue ne montre que ce qui s'achète. Les pièces vendues et les
         réalisations de portfolio restent visibles dans la galerie de leur
         atelier. */
      isForSale: true,
      availability: 'AVAILABLE',
      // Un atelier dont l'agrément est retiré disparaît du catalogue, même si
      // ses fiches sont restées publiées.
      maker: {
        kycStatus: 'APPROVED',
        deletedAt: null,
        ...(query.maker ? { slug: query.maker } : {}),
        ...(query.city ? { city: { name: { equals: query.city, mode: 'insensitive' } } } : {}),
      },
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            makerPriceXof: {
              ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
              ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
      ...(query.inStock
        ? { OR: [{ isMadeToOrder: true }, { quantityAvailable: { gt: 0 } }] }
        : {}),
    };
  }

  private orderBy(sort: CatalogQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'price_asc':
        return [{ makerPriceXof: 'asc' }, { id: 'asc' }];
      case 'price_desc':
        return [{ makerPriceXof: 'desc' }, { id: 'asc' }];
      case 'rating':
        return [{ ratingAvg: 'desc' }, { id: 'asc' }];
      case 'recent':
      case 'relevance':
      default:
        return [{ createdAt: 'desc' }, { id: 'asc' }];
    }
  }

  /**
   * On demande toujours une ligne de plus que la page : sa présence dit qu'il
   * reste des résultats, sans le `COUNT(*)` complet qu'exigerait un total.
   */
  private page(
    items: Parameters<ProductService['toPublic']>[0][],
    limit: number,
  ): Page<PublicProduct> {
    const hasMore = items.length > limit;
    const visible = hasMore ? items.slice(0, limit) : items;

    return {
      items: visible.map((item) => this.products.toPublic(item)),
      nextCursor: hasMore ? (visible[visible.length - 1]?.id ?? null) : null,
    };
  }
}
