CREATE TABLE IF NOT EXISTS staff_pins (
      staff_id TEXT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default',
      pin_code TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
