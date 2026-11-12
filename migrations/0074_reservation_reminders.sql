-- Written by hand, not generated.
--
-- The day-before reservation reminder email (shared/reminders.mjs). One row
-- per booking already reminded, so the reminder goes out once and never again
-- however often the schedule fires. A table, not a column, so this is a no-op
-- (IF NOT EXISTS) on a database created from today's 0001.
CREATE TABLE IF NOT EXISTS reservation_reminders (
      reservation_id TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );
