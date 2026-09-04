import { describe, expect, it } from 'vitest';

import { cursorArgs, cursorQuerySchema, paginate, toPage } from './pagination';

describe('pagination par curseur', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: `id-${index}`, value: index }));

  it('rend une page pleine et le curseur de la dernière ligne quand il reste des résultats', () => {
    // 4 lignes demandées, 5 rendues → il en reste
    const page = toPage(rows.slice(0, 4 + 1), 4);
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBe('id-3');
  });

  it('rend un curseur nul sur la dernière page', () => {
    const page = toPage(rows, 10);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('accepte une clé de curseur personnalisée', () => {
    const page = toPage(rows.slice(0, 3), 2, (row) => `v${row.value}`);
    expect(page.nextCursor).toBe('v1');
  });

  it('cursorArgs demande une ligne de plus, et saute le curseur quand il est fourni', () => {
    expect(cursorArgs({ limit: 20 })).toEqual({ take: 21 });
    expect(cursorArgs({ limit: 20, cursor: 'id-2' })).toEqual({
      take: 21,
      cursor: { id: 'id-2' },
      skip: 1,
    });
  });

  it('la query a une limite par défaut et refuse les valeurs hors bornes', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(25);
    expect(cursorQuerySchema.parse({ limit: '40' }).limit).toBe(40);
    expect(() => cursorQuerySchema.parse({ limit: '999' })).toThrow();
    expect(() => cursorQuerySchema.parse({ limit: '0' })).toThrow();
  });

  it('paginate enchaîne findMany et le découpage', async () => {
    const calls: unknown[] = [];
    const page = await paginate(
      async (args) => {
        calls.push(args);
        return rows.slice(0, args.take);
      },
      { limit: 4 },
      { where: { active: true } },
    );

    expect(calls[0]).toMatchObject({ where: { active: true }, take: 5 });
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBe('id-3');
  });
});
