# Multi-tenancy — how one deployment serves many restaurants

One Worker, one D1 database (`zhaoyun-ordering`), many restaurants. Every row
that belongs to a restaurant carries `tenant_id`; every query is scoped to the
caller's tenant. There is no per-tenant database and no per-tenant Worker.

## The tenant

- `tenants` (`shared/tenant.mjs`): `id`, `slug` UNIQUE, `name`, `status`
  (`active` | `disabled`), `config_json`, `created_at`, `updated_at`.
- The first tenant is the default one: id `t_default`, slug `default`, named
  after the restaurant the deployment started as (its `restaurant_name`
  setting, else `Chiri`). All data that predates tenants lives under it.
- `config_json` holds the per-tenant config: name, logo, language, currency,
  tax percent, hours — and the hooks for what comes later (`billing`,
  `features`), so a tenant gains billing or a feature flag without a schema
  change. `normalizeTenantConfig` is the shape; `tenantView` is what the API
  shows.
- A disabled tenant keeps its data and loses its access: sign-ins are
  rejected and the API answers 403. Deletion is a separate, explicit, audited
  operation (phase 3), never a side effect of disabling.

## Accounts: who may do what

- `accounts` carries `tenant_id`, `role` (`owner` | `admin`), `status`
  (`active` | `disabled`), `email`, `password_enc`.
- There is exactly one platform owner: the first account ever registered
  (`OWNER_ACCOUNT_SQL`: `WHERE role = 'owner' ORDER BY created_at, id LIMIT 1`).
  The owner creates tenants and their admins; an `admin` administers only its
  own tenant. `accounts.login` stays globally UNIQUE, so a sign-in names one
  account without ambiguity.
- No public self-service registration. `REGISTER_ACCOUNT_SQL` is bootstrap
  only: it inserts only while no account exists at all (`WHERE NOT EXISTS
  (SELECT 1 FROM accounts)`) — the first account ever is the platform owner.
  (The default tenant is seeded at database creation, so a "no tenant yet"
  condition would never be true and nobody could ever register.) After that,
  accounts arrive only through the owner (phase 3: the owner dashboard creates
  the tenant and issues the invite).
- A new admin sets its own password through a one-time, expiring link
  (`account_tokens`, kind `invite` | `reset`, 7 days, `ACCOUNT_TOKEN_TTL_MS`).
  Only the SHA-256 of a token is stored. Forgot-password uses the same shape;
  a user changes its own password after verifying the old one.
- The owner can also see and change a user's password directly — that is a
  requirement, not a convenience. Beside the PBKDF2 hash, a password set while
  a view key is configured keeps an AES-256-GCM copy (`password_enc`:
  base64 of 12-byte nonce + ciphertext), keyed by `PASSWORD_VIEW_KEY`
  (base64 of 32 bytes, in the server environment / a Worker secret, never in
  code or git; `shared/tenant.mjs`: `importPasswordViewKey`,
  `encryptPasswordForOwner`, `decryptPasswordForOwner`). Login never depends
  on it, and a password set before any key existed has no copy — the owner
  cannot see it until it is set again, because a hash cannot be decrypted.
  Every owner view or change of a password is audit-logged, without recording
  the password itself.
  - The risk is accepted and on the record: if the database and the key leak
    together, every customer password is exposed. The key is kept apart from
    the database for exactly that reason.

## How a request finds its tenant

`shared/http.mjs` resolves the tenant in `serve()`, before the dispatch, then
passes the tenant-scoped store into `handle()` — `handle()` never sees the
unscoped store. The order, in `store.resolveTenant` plus two fallbacks:

1. `x-admin-token` — an account session (tenant from the account), a tenant
   role token (`tenant_tokens`), or a POS PIN session (tenant from the staff row).
2. `x-device-token` — a paired POS device (`pos_devices`).
3. `x-table-token` + table — a guest table (`restaurant_tables`).
4. `x-customer-token` — a guest account (`customers`).
5. `x-reservation-token` — a reservation.
6. `?restaurant=` slug / `x-restaurant` header — a public catalog fallback.
7. The shared env tokens (`ADMIN_TOKEN` / `STAFF_TOKEN` / `KITCHEN_TOKEN`)
   resolve to the default tenant only, as the legacy fallback.
8. A deployment with exactly one tenant resolves to it.

A request that names no tenant at all resolves to the default tenant (the
store fails closed to it), never to everything. `requireRole` additionally
refuses a session whose tenant is not the resolved one, so a session from
one restaurant cannot be replayed against another.

When a deployment has exactly one tenant, guest sign-in falls back to it, so
today's UX does not change. A guest flow without a table (pickup, menu
browsing) names the restaurant by slug; a member whose email belongs to
exactly one other tenant signs in there instead
(`tenantForCustomerEmail`).

Per-tenant role tokens (`tenant_tokens`: token hash, tenant, role) replace the
shared env tokens for kitchen screens and staff tablets — a shared staff token
would otherwise admit tenant B's tablets to tenant A's data. The env tokens
stay as the default tenant's legacy fallback.

## Scoping rules

- `createStore(driver, options = {})`, `options = { tenantId = null,
  passwordViewKey = null }`. A null tenantId resolves to the default tenant
  (`t_default`) — fail-closed, not unscoped: the new schema cannot serve the
  old unscoped reads. `withTenant(tenantId)` returns a scoped store. The
  Worker builds a fresh store per request; Node builds one store per server
  and scopes it per request in `serve()`.
- `tenant_id` is always the first bound parameter in every scoped statement:
  the first `WHERE` condition, the first `INSERT` column. Sub-stores
  (`createCustomerStore`, `createDeliveryStore`, `createReservationStore`,
  `createWaitlistStore`) take `tenantId` in their options too.
- Per-tenant uniqueness, so two restaurants may share a SKU, a table number,
  an order number or a login-free namespace: products `UNIQUE(tenant_id,
  sku)`; orders `UNIQUE(tenant_id, order_no)` and `UNIQUE(tenant_id,
  client_request_id)`; receipts the same pair; `day_closings` per-tenant
  `closing_no` / `last_receipt_no`; staff `UNIQUE(tenant_id, name)`;
  customers `UNIQUE(tenant_id, email)`; reservations `UNIQUE(tenant_id,
  reference)`; delivery `UNIQUE(tenant_id, provider, external_id)`; vouchers,
  tables, stock, claims, sessions and the drawer are keyed by tenant first;
  `journal` is keyed `(tenant_id, seq)` — one hash chain per tenant, because
  `verifyJournal` needs a contiguous sequence and a filtered global chain
  cannot verify. The journal's text is unchanged: no tenant in the hash, so
  entries written before tenants keep verifying.
- `media_files` carries `tenant_id`; the seed photos belong to the default
  tenant. Provisioning a new tenant copies the seed media rows with new ids
  and rewrites the `product_media` URLs (the id is the URL key), and generates
  new product ids, remapping media, stock and bundle references
  (`provisionTenant`, a store method).
- `auth_throttle` is global by design; login keys stay global because logins
  are globally unique. `admin_gate` / `admin_sessions` are legacy and empty.
- Sequences (`receipt_no`, `closing_no`) are `MAX+1` per tenant; `order_no`
  is date-based plus an id fragment, with the per-tenant UNIQUE behind it.

## Migrations

- Node: `migrateToMultiTenant(db, schemaSql)` in `server/database.mjs`, run
  on start after the schema and the column loop, before the seed. It creates
  the default tenant (named from `restaurant_name`), rebuilds every tenant
  table under the new definition with its rows carried across, and makes the
  first account the owner. Each step checks before it writes, so it is safe
  to run on every start. A rebuilt table is created under its own name, never
  renamed into it — a rename rewrites the stored definition with the name
  quoted, and the result would no longer read as a fresh database does.
  Verified: a database built from the pre-tenant schema and migrated reads
  byte-identical (all 104 schema objects) to a fresh one, and a second run
  changes nothing.
- D1: `migrations/0112_multi_tenancy.sql`, the same migration in SQL
  (generated by `/tmp/gen-0112.py` from the two 0001s; re-run the generator
  if the schema changes). The catalog (`0002_seed_catalog.sql`) seeds the
  default tenant row first, so the dishes' foreign key holds. Wrangler runs
  each file once.
- `SCHEMA_VERSION` is 12. The D1 test (`server/tests/d1-migrations.test.mjs`)
  holds the line: the committed migrations match the server's schema and
  seed, every incremental is a no-op on a fresh database and brings a
  deployed one up to date (a database that missed a migration takes it and
  everything after it, the way wrangler applies them), and 0112 carries a
  deployed database's rows into the default tenant.

## What is still open (phase 3 decides, not this document)

- Provisioning flow: the owner creates the tenant and invites its admin from
  the owner dashboard. No self-service.
- Invite delivery: the system generates the link; if mail is configured and
  an email is given, it is sent; otherwise the owner copies it from the
  dashboard. The data model supports both.
- Disabled tenants: sign-ins rejected, API 403, data retained. Deletion is
  explicit and audited; a disabled tenant's data is kept 90 days before the
  owner may purge it.
- Per-tenant delivery provider config: a hook in `tenants.config_json` only.
  Until it exists, delivery webhooks land in the default tenant.
- Guest pickup without a table: restaurant slug param, falling back to the
  default tenant on single-tenant deployments; a member's email resolves to
  its unique tenant at sign-in.
- Audit rows written before any tenant is resolved (a 403 with no session):
  they carry the default tenant today; phase 3 may give them a NULL tenant.
- Retention: `purgeExpired()` removes expired sessions (account / POS /
  customer), auth-throttle rows, used or expired account tokens, email codes,
  outbox mail older than 30 days and audit rows older than 24 months. It runs
  on the Worker's scheduled cron and on a Node interval.
- Indexes: every index is tenant-first; the hot joins have theirs
  (`order_items.order_id`, `product_media.product_id`, `orders.table_no`,
  `vouchers.sold_receipt_id`, `pos_sessions.staff_id`,
  `account_sessions.account_id`, `customer_sessions.customer_id`,
  `service_requests.table_no`, `reservations.table_no`,
  `order_item_voids.order_id`, `staff_settlements.staff_id`,
  `print_jobs.order_id`, `printer_status.bridge_id`,
  `email_codes.email`, `tenant_tokens.tenant_id`). No foreign keys were added
  beyond the `tenant_id` references: D1 does not enforce them, and the
  Node-only `product_stock.product_id → products(id)` is still undecided.

## The owner dashboard (phase 3, not built yet)

A standalone, key-gated page — not in the normal admin nav — mirroring the
German handbook's `stats.html`: a key saved locally, an `X-Admin-Key`
header. It opens new accounts (tenant + invite), shows any user's password
on click and changes it directly, enables/disables accounts, and shows data
as totals plus one row per restaurant (orders today/total, revenue, dishes,
staff count, last active) — aggregates only, never another restaurant's
order details. Every create, password view, password change and disable is
audit-logged. It builds on the store methods and HTTP routes from this phase
(`createTenant` / `provisionTenant`, invite / set-password / forgot-password,
owner password view/change, tenant list); the page itself is phase 3's work.
The set-password page the invite and reset links point at
(`/set-password?token=...`) does not exist yet either — phase 3 builds it.
