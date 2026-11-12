-- Written by hand, not generated.
--
-- Walk-in waitlist (shared/waitlist.mjs, shared/waitlist-store.mjs): parties
-- the floor takes at the door when every table is full, in the order they
-- arrived. A party waits, is notified when a table frees up, then is seated
-- or has left. The email is optional — if given, "your table is ready" can be
-- sent through the same Brevo pipeline as bookings (shared/mail.mjs).
--
-- IF NOT EXISTS, because 0001 (generated from the Node schema) already has it
-- on a new database.
CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      party INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notified_at TEXT
    );
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status, created_at);
