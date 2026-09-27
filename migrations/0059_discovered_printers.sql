-- Written by hand, not generated.
--
-- The printers a print bridge found on the shop's network (server/print-agent.mjs,
-- discoverPrinters), for the console to offer without anyone typing an
-- address. A table of its own, IF NOT EXISTS, because 0001 (generated from
-- the Node schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS discovered_printers (
      address TEXT NOT NULL,
      port INTEGER NOT NULL,
      escpos INTEGER NOT NULL DEFAULT 0,
      bridge_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (address, port)
    );
