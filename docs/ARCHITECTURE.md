# Faatix architecture (November 2026)

## The three parts

| Part | Folder | What it is |
| --- | --- | --- |
| Website | `faatix-website/` | Public marketing site (Vite + React). "Request a demo" → contact form → Super admin → Support → Website messages. "Sign in" → the app. Not deployed yet. |
| App | `client/` | Business app + super admin. Opens on the sign-in page. Built into `client/dist` and served by the API server. |
| API | `server/` | Express + MySQL. One code base for every business. |

## Databases

```
                    ┌────────────────────────────── central database (DB_NAME, "faatix_core") ──────────────────────────────┐
                    │ platform: businesses (registry: slug, status), business_types, business_domains, database_registry,       │
                    │           platform_admins (+ view platform_users), platform_roles, platform_permissions,                    │
                    │           plans (+ view subscription_plans), subscriptions, subscription_payments (+ view platform_payments),│
                    │           trial_records, provisioning_jobs, backups, business_modules, support_*, announcements,             │
                    │           contact_messages, blocked_ips, platform_settings (+ view system_settings), audit_logs              │
                    │ data of "shared" businesses (everything registered before the update, with business_id on every row)      │
                    └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   faatix_prodima_db             faatix_<slug>_db  …     one per business registered with "Its own database"
   (same tables as the business part of the schema; only that business's rows; the businesses row has the same id as in the core)
```

* `database_registry` says where each business lives: `mode` = `shared` | `dedicated`, database name, host, user,
  **password encrypted with AES-256-GCM** (`TENANT_DB_KEY`), status, schema version, last migration, last backup.
* Each dedicated database has its own MySQL user with rights on that database only.
* Every database has `schema_versions`; the code's version is `SCHEMA_VERSION` in `server/src/config/migrate.js`.
  On start the server migrates the core, then every dedicated database. Super admin → Databases can run it again.

## How a request finds its database

`server/src/config/db.js` exports `pool`, a stand-in that forwards each call to the current request's database
(AsyncLocalStorage). `lib/tenancy.js → tenantContext` picks it, on the server only:

1. the signed session cookie (its business id), then
2. the host: `<slug>.<BASE_DOMAIN>` or a verified custom domain (`business_domains`), then
3. the `X-Tenant` header (the slug), sent by the app after opening the branded link `/b/<slug>`.

A session used on another business's address is refused (401). Business status (active / suspended / …) and
"sign everyone out" are always read from the central registry. Platform data (plans, trials, support) is always read
from the core (`corePool`).

## Registering a business (Super admin → Businesses → Register a business)

1. Form: business (name, subdomain, type, phone…), owner (username; password optional — then generated and shown once),
   plan & branches (plan, trial days, first branch, branch limit), data (own database or shared), review.
2. `POST /api/admin/businesses`: one transaction in the core — business `pending`, trial / plan, registry row,
   provisioning job (the owner's password only as a bcrypt hash, removed when the job succeeds).
3. The job (`lib/provisioning.js`): **database → user → schema → data → activate**. Each step can run again.
   A failure keeps the business inactive (`provisioning`), records the error, and Super admin can **Try again**.
   It can't be activated by hand before that (`notProvisioned`).

## Business statuses

`pending` → `provisioning` → `active`; then `suspended`, `expired`, `archived`, `deactivated` (older). Only `active` can sign in.

## Branches

All branches of a business share its database. Plan limit `plans.max_branches`, overridden per business by
`businesses.max_branches` (Super admin → Branch overview / business page) — checked by the API when a branch is added.
Staff: own branch (`business_user_roles.branch_id`) plus extra branches (`user_branch_access`); with extra branches they
switch only between those (enforced in `middleware/auth.js`). Owners always see all branches. Branches have a code and a manager.

## Platform roles

| Code | Name | Can |
| --- | --- | --- |
| owner | Super Admin | everything |
| admin | Platform Manager | businesses, register, billing, support, reports, settings, domains |
| technical | Technical Admin | register / retry setup, hosting & domains, databases, migrations, backups, security |
| billing | Finance Admin | plans, subscriptions, payments, reports |
| support | Support Agent | support, messages, announcements, notes |

## Backups

`lib/backups.js` writes gzip JSON-lines files (`{table,row}` per line) to `BACKUP_DIR`: the core, or one business
(its own database, or its rows in the core). Manual (Super admin → Backups) or daily (System settings). Download and
delete from the same page.

**Restore** (manual, on purpose): create an empty database, run the server's migrations on it (or `npm run db:init`
with that DB_NAME), then insert the rows from the file table by table (each line is one row; `{ "$base64": … }` marks
binary data such as stored images). Check it, then point `database_registry` at it. Faatix never restores over live data.

## Production / DNS checklist

* `TENANT_DB_KEY` — 64 hex characters, set once, kept safe (losing it means the dedicated databases' passwords can't be read).
* MySQL user of the server (`DB_USER`) needs `CREATE`, `CREATE USER`, `GRANT OPTION` (and `ALL` with grant on new databases).
  On a host without them set `TENANT_DB_MODE=shared` (or `TENANT_DB_USERS=false` to skip the per-business users).
* `BASE_DOMAIN=faatix.com`; DNS: `app.faatix.com` (or the apex) and wildcard `*.faatix.com` → the Railway service; add both as
  Railway custom domains (wildcard domains need DNS verification there). Without it, use the `/b/<slug>` links.
* Custom domains: the business adds a TXT record `_faatix-verify.<domain>` (value on the Hosting page) and a CNAME to the server.
* `BACKUP_DIR` on a Railway volume, so backups survive deploys.
* `WEBSITE_ORIGIN` when the website is deployed.

## Moving a shared business into its own database

Super admin → Databases → **Move to own database** (Technical Admin / Super Admin). A job with 8 steps, shown live:
pause (status `provisioning`: its users wait) → backup → create database → restricted user → tables → copy every row
(tables with business_id, and their child tables through the parent row) → compare row counts → switch the registry, give the
old status back and remove the old rows from the central database (images stay there as well, so old image links keep working).
Any failure drops the half-made database and puts everything back as it was. Users' sessions keep working (same ids).
After the move, its staff sign in on the business's own address (subdomain or /b/<slug>).

## Modules per business

Super admin → business page → **Modules**: invoices, customers, suppliers, purchases, promotions, shifts, expenses, cashbook,
reports, HR, branches, devices, warranties, rolls, tailoring, waste (`server/src/lib/modules.js`). Off = hidden in the business's app, and the
API refuses every change under its paths (403 `moduleDisabled`); reading stays allowed because other screens share those lists.

## Not done yet

* Putting a business database on another MySQL server (the registry can hold host / port per business, but registering and
  moving always create the database on the main server).
* Online ordering links (/order/<code>) of an own-database business work on its subdomain or custom domain only.
