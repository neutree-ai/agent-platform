-- workspace_tokens: per-workspace credentials for the workload's own calls
-- back into cp (agent server, memory-fuse / afs sidecars).
--
-- Deliberately a SEPARATE table from both service_tokens and
-- environment_tokens, for the same reason those two are separate from each
-- other: the principal this yields is narrower than either. A service token
-- resolves to a full user; an environment token resolves to a runner's whole
-- environment; this one resolves to exactly ONE workspace. The auth middleware
-- yields { workspaceId } and never a user, so a leaked token cannot reach past
-- the workspace it was minted for — routes carrying an :id compare it against
-- the principal.
--
-- Mechanics are the shared ones: random secret surfaced once, SHA-256 hash at
-- rest, Bearer → hash compare, revoked_at. The plaintext lives only in the
-- workload's process environment; this table never stores it, so a token that
-- is lost is re-minted rather than recovered.
--
-- Several live rows per workspace are expected, not exceptional: tokens are
-- minted per placement, so a rolling update briefly has the outgoing and
-- incoming pods holding different ones.
--
-- Pure additive: no backfill. Workspaces with no row simply have no token yet
-- and keep using the pre-migration unauthenticated path until they are rebuilt.
--
-- The migration runner (services/db/pool.ts) wraps each file in its own
-- transaction, so no explicit BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS workspace_tokens (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    created_at   timestamp with time zone NOT NULL DEFAULT now(),
    last_used_at timestamp with time zone,
    revoked_at   timestamp with time zone
);

-- The auth hot path (Bearer token → hash lookup) is served by the UNIQUE
-- constraint's own index; a second one on the same column would only add a
-- write per mint.

-- Per-workspace sweeps: revoke-on-stop, and the reconcile pass that retires
-- superseded tokens once the placement that minted them is gone.
CREATE INDEX IF NOT EXISTS idx_workspace_tokens_workspace
    ON workspace_tokens (workspace_id)
    WHERE revoked_at IS NULL;
