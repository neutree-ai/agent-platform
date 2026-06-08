# Control-plane database migrations

Plain `.sql` files applied in lexical order at control-plane startup. There is no separate migration CLI — the runner lives in [`src/services/db/pool.ts`](../src/services/db/pool.ts).

## How the runner works

On boot the control-plane:

1. Ensures a `schema_migrations(id, applied_at)` table exists.
2. Loads the set of already-applied ids: `SELECT id FROM schema_migrations`.
3. Reads every `*.sql` file in this directory, **sorted by filename**.
4. For each file, `id = <filename without .sql>`. If `id` is already in `schema_migrations`, it is **skipped**; otherwise the file runs inside a transaction and the `id` is recorded.

So a migration runs **exactly once per database**, keyed on its filename. The filename — not its contents — is the identity. Renaming an applied migration makes the runner think it is new and run it again.

## The baseline: `001_init.sql`

`001_init.sql` is a **squashed consolidation** of the original migration chain (historically `001_init` … `114_workspace_layout`). The schema it produces is identical to running that full chain.

- On a **fresh** database it builds the entire schema in one step, then records `001_init`.
- On an **existing** database (our production and every deployed self-host install) `001_init` is **already recorded**, so it is skipped — the schema is already there. The historical ids `002_…` through `114_…` also remain recorded on those databases; their files no longer exist here, and the runner only iterates over files that are present, so they are inert.

It contains **pure schema only**. Bootstrap rows (the internal `system` user and the singleton `system_settings` row) are seeded by [`scripts/seed-admin.ts`](../scripts/seed-admin.ts), not by a migration.

## Adding a new migration

**Start numbering at `115_`.** The ids `001`–`114` are occupied on existing databases by the pre-squash chain. Reusing one of those stems would cause the migration to be **silently skipped** on existing installs while still running on fresh ones — a silent schema divergence with no error. Continuing from `115` avoids the entire collision surface.

Rules of thumb:

- **Filename**: `NNN_snake_case_description.sql`, three-digit zero-padded, strictly increasing. Next free number is **115**.
- **Never rename or edit an applied migration.** To change something already shipped, add a new migration.
- Each file runs once, in its own transaction. Write it to succeed against the schema as produced by every migration before it.
- **No seed/bootstrap data here** — schema only. Data that every install needs goes into `scripts/seed-admin.ts` (idempotent, `ON CONFLICT DO NOTHING`).

> Why 115 and not 002: a brand-new install's ledger only contains `001_init`, so `002_*` would look free there — but our production and customer databases still carry the `002`–`114` ids from before the squash. `115+` is the one numbering that is correct on **all** populations.
