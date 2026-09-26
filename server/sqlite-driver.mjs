/**
 * node:sqlite as the store's driver (shared/store.mjs): the same four calls
 * the Worker makes of D1. Statements are prepared once each. node:sqlite is
 * synchronous, so a batch is a BEGIN IMMEDIATE … COMMIT and nothing else in
 * this process runs between its statements.
 */
export function sqliteDriver(db) {
  const prepared = new Map();
  function prepare(sql) {
    let statement = prepared.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      prepared.set(sql, statement);
    }
    return statement;
  }
  const runSync = (sql, params) => Number(prepare(sql).run(...params).changes);
  return {
    first: async (sql, ...params) => prepare(sql).get(...params) ?? null,
    all: async (sql, ...params) => prepare(sql).all(...params),
    run: async (sql, ...params) => runSync(sql, params),
    batch: async (list) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const changes = list.map(([sql, params]) => runSync(sql, params));
        db.exec("COMMIT");
        return changes;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    /** For the seeding at start-up, which runs before anything else can. */
    sync: { get: (sql, ...params) => prepare(sql).get(...params) ?? null, all: (sql, ...params) => prepare(sql).all(...params), run: (sql, ...params) => runSync(sql, params) }
  };
}
