-- BYOI P2 — environment_tokens: per-environment runner credentials.
--
-- A remote env-runner (running in customer infra, behind NAT) authenticates its
-- outbound /env/v1/* calls with a long-lived, revocable token scoped to ONE
-- environment. See tmp/byoi-environments-design.md §3.2, §9.
--
-- Deliberately a SEPARATE table, NOT a reuse of service_tokens: a service token
-- resolves to user.sub == created_by (full user authority), far too broad for a
-- runner that should only read/write placements of its own environment. We reuse
-- the *mechanics* (tos_-prefixed secret shown once, token_hash at rest, Bearer →
-- hash compare, revoked_at) but the auth middleware yields a restricted principal
-- ({ environmentId }), never a user — every downstream query is forced to
-- WHERE environment_id = $principal.environmentId (design §9 tenant isolation).
--
-- Pure additive: no backfill. The built-in environment never gets a token — it
-- is served by the in-process / same-cluster direct-DB runner, not the protocol.
--
-- The migration runner (services/db/pool.ts) wraps each file in its own
-- transaction, so no explicit BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS environment_tokens (
    id             text PRIMARY KEY,
    environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name           text NOT NULL,
    token_hash     text NOT NULL,
    created_by     text NOT NULL,
    created_at     timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at     timestamp with time zone
);

-- Auth hot path: Bearer token → hash lookup (only non-revoked rows matter).
CREATE INDEX IF NOT EXISTS idx_environment_tokens_hash
    ON environment_tokens (token_hash)
    WHERE revoked_at IS NULL;

-- Listing/managing tokens for one environment.
CREATE INDEX IF NOT EXISTS idx_environment_tokens_environment
    ON environment_tokens (environment_id);
