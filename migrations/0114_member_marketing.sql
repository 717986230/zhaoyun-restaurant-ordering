-- Written by hand, not generated.
--
-- 会员分群 + 群发营销 (shared/segments.mjs, shared/store.mjs): a member's
-- marketing consent (GDPR opt-in) with the token that unsubscribes them, the
-- broadcasts the manager sends to a segment, and the claim ledger that keeps a
-- campaign from mailing a member twice. Three tables of their own, new with
-- this migration, so a deployed D1 is simply given them. IF NOT EXISTS, because
-- a database built from today's 0001 already has them. Mirrors the tables in
-- server/database.mjs.
CREATE TABLE IF NOT EXISTS member_consent (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      marketing INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_member_consent_token ON member_consent(token);

CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      segment_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent')),
      audience INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS broadcast_sends (
      broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (broadcast_id, customer_id)
    );
