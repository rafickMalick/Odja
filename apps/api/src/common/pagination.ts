import { z } from 'zod';

/**
 * Pagination par curseur, jamais par `OFFSET`.
 *
 * Au-delà de quelques milliers de lignes, `OFFSET n` fait relire à PostgreSQL
 * les `n` lignes qu'il saute : le coût grandit avec le numéro de page. Un
 * curseur — l'identifiant de la dernière ligne rendue — reprend exactement là
 * où l'on s'était arrêté, à coût constant.
 *
 * Le motif était déjà écrit à la main dans la recherche du catalogue
 * (`search.service.ts`). Il est ici une fois, pour toutes les listes.
 */

/** Query commune aux routes de liste : `?cursor=…&limit=…`. */
export const cursorQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Arguments Prisma pour une requête paginée.
 *
 * On demande **une ligne de plus** que la page : sa présence dit qu'il reste
 * des résultats, sans le `COUNT(*)` complet qu'exigerait un total. Le `skip: 1`
 * saute la ligne du curseur elle-même, déjà rendue à la page précédente.
 */
export function cursorArgs(query: CursorQuery): {
  take: number;
  cursor?: { id: string };
  skip?: number;
} {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

/**
 * Découpe le résultat brut (`limit + 1` lignes) en page + curseur suivant.
 *
 * @param rows   lignes renvoyées par Prisma, dans l'ordre d'affichage
 * @param limit  taille de page demandée
 * @param keyOf  extrait l'identifiant qui servira de curseur (défaut : `row.id`)
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T>;
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => string): Page<T>;
export function toPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => string = (row) => (row as { id: string }).id,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last !== undefined ? keyOf(last) : null,
  };
}

/**
 * Applique curseur + page à un delegate Prisma en une passe.
 *
 * `findMany` doit accepter `take` / `cursor` / `skip` — c'est le cas de tous
 * les delegates Prisma. Les autres arguments (`where`, `include`, `orderBy`…)
 * sont passés tels quels.
 */
export async function paginate<Row extends { id: string }, Args extends Record<string, unknown>>(
  findMany: (args: Args & ReturnType<typeof cursorArgs>) => Promise<Row[]>,
  query: CursorQuery,
  args: Args,
): Promise<Page<Row>> {
  const rows = await findMany({ ...args, ...cursorArgs(query) });
  return toPage(rows, query.limit);
}
