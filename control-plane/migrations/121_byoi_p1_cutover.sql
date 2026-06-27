-- BYOI P1 cutover — make the big-bang control inversion safe at deploy time.
--
-- Background: migration 120 backfilled placements with desired==observed. But
-- between the P0 deploy and this P1 deploy, the OLD cp kept stopping/starting
-- workspaces via the direct k8s path WITHOUT updating desired_phase — so desired
-- may now be stale. If the env-runner started reconciling against stale desired
-- it would "correct" workspaces to the wrong state (e.g. restart one the user
-- stopped). Workspaces created in that window also have no placement at all.
--
-- This migration re-establishes the zero-drift invariant from the authoritative
-- current source (workspaces.status, which the old cp kept fresh):
--   1. backfill a placement for any workspace missing one
--   2. re-sync desired_phase = current status, observed = desired,
--      observed_version = spec_version, and rebuild spec from config (with
--      agentType) so the runner has a complete, appliable baseline
-- After this the runner sees no drift and only acts on what the new cp writes.
--
-- DEPLOY ORDER: roll out cp (this migration runs at its boot) BEFORE starting
-- env-runner-k8s, so desired is re-synced before the runner ever reconciles.

-- 1. Backfill placements for workspaces created in the P0→P1 window.
INSERT INTO workspace_placements
    (workspace_id, environment_id, desired_phase, spec, spec_version,
     observed_phase, observed_version)
SELECT
    w.id,
    'builtin',
    CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
    jsonb_build_object(
        'agentType', COALESCE(wc.agent_type, 'claude-code'),
        'resources', COALESCE(wc.compute_resources, '{}'::jsonb),
        'version', 1
    ),
    1,
    CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
    1
FROM workspaces w
LEFT JOIN workspace_config wc ON wc.workspace_id = w.id
WHERE NOT EXISTS (SELECT 1 FROM workspace_placements p WHERE p.workspace_id = w.id)
ON CONFLICT (workspace_id) DO NOTHING;

-- 2. Re-sync every placement to current reality: desired = status, observed =
--    desired, observed_version = spec_version → zero drift. Rebuild spec from
--    config so it carries agentType (the 120 baseline only had computeResources).
UPDATE workspace_placements p
   SET desired_phase    = CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
       observed_phase   = CASE WHEN w.status = 'stopped' THEN 'stopped' ELSE 'running' END,
       observed_version = p.spec_version,
       spec             = jsonb_build_object(
                            'agentType', COALESCE(wc.agent_type, 'claude-code'),
                            'resources', COALESCE(wc.compute_resources, '{}'::jsonb),
                            'version', p.spec_version
                          ),
       reported_at      = now()
  FROM workspaces w
  LEFT JOIN workspace_config wc ON wc.workspace_id = w.id
 WHERE w.id = p.workspace_id
   AND p.environment_id = 'builtin';
