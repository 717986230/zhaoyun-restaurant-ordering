-- Written by hand, not generated.
--
-- 营销活动 (shared/promotions.mjs): the restaurant's own promotions — a
-- time-limited discount the till applies for them. A table of its own, new
-- with this migration, so a deployed D1 is simply given it. IF NOT EXISTS,
-- because a database built from today's 0001 already has it. Mirrors the
-- promotions table in server/database.mjs.
CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name_zh TEXT NOT NULL DEFAULT '',
      name_de TEXT NOT NULL DEFAULT '',
      name_en TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'percent',
      config_json TEXT NOT NULL DEFAULT '{}',
      scope TEXT NOT NULL DEFAULT 'order',
      category TEXT,
      active_from TEXT,
      active_to TEXT,
      weekdays TEXT NOT NULL DEFAULT '',
      start_min INTEGER,
      end_min INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_promotions_tenant ON promotions(tenant_id, enabled);
