CREATE TABLE IF NOT EXISTS customer_contacts (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
