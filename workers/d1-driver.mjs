/**
 * D1 as the store's driver (shared/store.mjs). A batch is D1's own `batch()`,
 * which is atomic: every statement or none.
 */
export function d1Driver(db) {
  const bind = (sql, params) => db.prepare(sql).bind(...params);
  return {
    first: (sql, ...params) => bind(sql, params).first(),
    all: async (sql, ...params) => (await bind(sql, params).all()).results ?? [],
    run: async (sql, ...params) => (await bind(sql, params).run()).meta?.changes ?? 0,
    batch: async (list) => (await db.batch(list.map(([sql, params]) => bind(sql, params)))).map((result) => result.meta?.changes ?? 0)
  };
}
