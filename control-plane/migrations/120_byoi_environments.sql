-- BYOI environments — foundation schema + zero-downtime backfill (P0, step 1).
--
-- Introduces the environment abstraction and the desired/observed placement
-- queue WITHOUT changing any runtime behavior: reconcile still runs the legacy
-- path, these tables are read-only side rows until P1 wires the in-process
-- runner as a consumer. See tmp/byoi-environments-design.md §3, §10 (P0), §13.
--
-- Safety invariant (design §13.1): every existing workspace is backfilled with
-- desired_phase == observed_phase and spec_version == observed_version, so the
-- runner sees "already converged" → zero apply / zero lifecycle action → pods
-- are never rebuilt. spec fidelity is intentionally a placeholder baseline;
-- apply() only fires on a future version bump, which rewrites the full spec.

-- The migration runner (services/db/pool.ts) wraps each file in its own
-- transaction, so no explicit BEGIN/COMMIT here.

----------------------------------------------------------------------
-- 1. Schema
----------------------------------------------------------------------

-- An environment is a place where workspaces can be provisioned. The built-in
-- environment is the platform's own cluster, served by KubernetesProvider via
-- an in-process runner. Reuses the platform's private|team|public visibility
-- model (design §3.1, §8); credentials are NEVER stored here.
CREATE TABLE IF NOT EXISTS environments (
    id                text PRIMARY KEY,
    user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              text NOT NULL,
    visibility        text NOT NULL DEFAULT 'private',
    kind              text NOT NULL,                       -- 'kubernetes' | 'docker' | ...
    status            text NOT NULL DEFAULT 'pending',     -- pending|online|degraded|offline
    capabilities      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- runner-reported feature/limits
    placement         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- region/gpu/labels for placement
    last_heartbeat_at timestamp with time zone,
    is_builtin        boolean NOT NULL DEFAULT false,
    created_at        timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT environments_visibility_check
        CHECK (visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text])),
    CONSTRAINT environments_user_name_unique UNIQUE (user_id, name)
);

-- Team sharing — mirrors prompt_grants / template_grants exactly (design §3.1).
CREATE TABLE IF NOT EXISTS environment_grants (
    environment_id text NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    team_id        text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    permission     text NOT NULL DEFAULT 'viewer',
    granted_by     text NOT NULL,
    granted_at     timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (environment_id, team_id),
    CONSTRAINT environment_grants_permission_check
        CHECK (permission = ANY (ARRAY['viewer'::text, 'editor'::text]))
);

-- The desired/observed placement queue, partitioned by environment_id
-- (design §3.3). One row per workspace.
CREATE TABLE IF NOT EXISTS workspace_placements (
    workspace_id     text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id   text NOT NULL REFERENCES environments(id),

    -- desired (cp writes)
    desired_phase    text NOT NULL,                        -- running|stopped|deleted
    spec             jsonb NOT NULL,
    spec_version     integer NOT NULL DEFAULT 1,

    -- observed (runner writes)
    observed_phase   text,                                 -- pending|starting|running|stopped|error|unknown
    observed_version integer,
    endpoint         jsonb,
    message          text,
    lease_owner      text,
    lease_expires_at timestamp with time zone,
    reported_at      timestamp with time zone,

    created_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- Runner pull query: WHERE environment_id = $me AND (spec drift OR phase drift).
CREATE INDEX IF NOT EXISTS idx_workspace_placements_environment
    ON workspace_placements (environment_id);

-- Placement result also recorded on workspace_config; NULL = built-in (design §3.4).
ALTER TABLE workspace_config ADD COLUMN IF NOT EXISTS environment_id text;

----------------------------------------------------------------------
-- 2. Built-in environment (idempotent)
----------------------------------------------------------------------

-- The built-in environment is owned by the platform 'system' user. On upgrades
-- this row already exists; on fresh installs initDb() runs before seed-admin,
-- so ensure it here (mirrors seed-admin's platform-invariant rows). On fresh
-- installs there are no workspaces yet, so the placement backfill below is a
-- no-op anyway.
INSERT INTO users (id, username, display_name, role)
VALUES ('system', '__system__', 'System', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO environments (id, user_id, name, visibility, kind, status, is_builtin)
VALUES ('builtin', 'system', 'Built-in', 'public', 'kubernetes', 'online', true)
ON CONFLICT (id) DO NOTHING;

----------------------------------------------------------------------
-- 3. Backfill placements for every existing workspace (idempotent)
----------------------------------------------------------------------

-- desired == observed and spec_version == observed_version → runner no-op.
-- spec is a placeholder baseline (compute_resources snapshot); the runner
-- overwrites it with the full spec on the first config change / version bump.
INSERT INTO workspace_placements
    (workspace_id, environment_id, desired_phase, spec, spec_version,
     observed_phase, observed_version)
SELECT
    w.id,
    'builtin',
    CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
    jsonb_build_object(
        'version', 1,
        'computeResources', COALESCE(wc.compute_resources, '{}'::jsonb)
    ),
    1,
    CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
    1
FROM workspaces w
LEFT JOIN workspace_config wc ON wc.workspace_id = w.id
ON CONFLICT (workspace_id) DO NOTHING;
