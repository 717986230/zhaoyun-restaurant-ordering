-- Written by hand, not generated.
--
-- Guests' table bookings (shared/reservations.mjs, shared/reservation-store.mjs),
-- each made from a guest's account (customer_id). The day and time are the
-- restaurant's own wall clock; the token behind a guest's link is kept as a
-- hash. IF NOT EXISTS, because 0001 (generated from the Node schema) already
-- has them on a new database.
CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      token_hash TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      party INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      table_no TEXT,
      source TEXT NOT NULL,
      customer_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date, time);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id, date);
