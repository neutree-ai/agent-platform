-- workspace_placements.runtime_mode: the workspace's runtime shape, projected
-- out of the placement spec as a first-class column.
--
-- The spec JSONB carries `runtimeMode` ('static' | 'auto-scaling') and is the
-- source of truth; this column is GENERATED from it, so the two cannot drift.
-- It exists because the shape is needed where the spec is not in hand — the
-- lifecycle calls (start / stop / destroy) act on a workspace id alone and would
-- otherwise have to probe the cluster for whichever workload shape happens to
-- exist — and because usage accounting groups by it.
--
-- NOT NULL is the point of the column as much as the value is: a spec written
-- without a runtimeMode fails the write instead of silently reading as static.
-- Exactly one place is allowed to supply the field for specs that lack it —
-- toWorkspaceSpec() in internal/env-runner-core/spec.ts, for rows predating it.

-- Backfill from the shape discriminant in use before the field existed: a
-- workspace_config.auto_scaling block means auto-scaling, its absence static.
UPDATE workspace_placements p
   SET spec = jsonb_set(
         p.spec,
         '{runtimeMode}',
         to_jsonb(CASE WHEN wc.auto_scaling IS NOT NULL THEN 'auto-scaling' ELSE 'static' END))
  FROM workspace_config wc
 WHERE wc.workspace_id = p.workspace_id
   AND NOT (p.spec ? 'runtimeMode');

-- A placement whose workspace has no config row at all is single-replica.
UPDATE workspace_placements
   SET spec = jsonb_set(spec, '{runtimeMode}', '"static"')
 WHERE NOT (spec ? 'runtimeMode');

ALTER TABLE workspace_placements
  ADD COLUMN IF NOT EXISTS runtime_mode text
  GENERATED ALWAYS AS (spec->>'runtimeMode') STORED;

ALTER TABLE workspace_placements
  ALTER COLUMN runtime_mode SET NOT NULL;

ALTER TABLE workspace_placements
  ADD CONSTRAINT workspace_placements_runtime_mode_check
  CHECK (runtime_mode IN ('static', 'auto-scaling'));
