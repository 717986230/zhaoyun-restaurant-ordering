-- Written by hand, not generated.
--
-- Wrong passwords and PINs, counted where every Worker isolate and every
-- Node process sees the same count (shared/http.mjs, guessBudget): an
-- in-memory count is one per isolate, and Cloudflare runs many. IF NOT
-- EXISTS, because 0001 (generated from the Node schema) already has it on a
-- new database.
CREATE TABLE IF NOT EXISTS auth_throttle (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      reset_at TEXT NOT NULL
    );
