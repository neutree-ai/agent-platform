-- Attribution columns for the two ledgers: where a workspace ran, and whose
-- model credentials its tokens were spent through.
--
-- Both are snapshots on the ledger row for the same reason user_id already is:
-- the rows they would otherwise be joined to are deleted with the workspace,
-- and a ledger has to be answerable after that.
--
-- Neither exists to exclude anything from metering. A workspace is metered the
-- same wherever it runs; these columns are what let a later rating layer tell
-- the cases apart — our own infrastructure cost covers only the built-in
-- environment, a user's consumption report covers everything they ran, and an
-- environment's owner may be billing their own users for what ran on theirs.
-- Which party is billed is a rating decision, and it needs this dimension to
-- be expressible at all.

ALTER TABLE workspace_runtime_events
  ADD COLUMN IF NOT EXISTS environment_id text,
  -- Whether that environment is the platform's own. Carried rather than joined
  -- because it is the one fact rating always needs and an environment row can
  -- outlive its usefulness or be removed.
  ADD COLUMN IF NOT EXISTS is_builtin boolean;

-- The log ships empty (migration 134 creates it), so there is nothing to
-- backfill and the columns can be required from the first row.
ALTER TABLE workspace_runtime_events
  ALTER COLUMN environment_id SET NOT NULL,
  ALTER COLUMN is_builtin SET NOT NULL;

-- The meter's newest-row-per-workspace read now also returns environment_id, so
-- it has to ride along in the covering index or that read falls back to a heap
-- fetch per workspace every 15 seconds.
DROP INDEX IF EXISTS idx_wre_workspace_ts;
CREATE INDEX idx_wre_workspace_ts
  ON workspace_runtime_events (workspace_id, ts DESC, id DESC)
  INCLUDE (environment_id, phase, ready_replicas, desired_replicas, spec_version,
           observed_template_version, env_offline);

-- The model provider a workspace's tokens were spent through, as configured at
-- the moment the usage was ingested. Nullable: rows predating this column have
-- no answer, and a workspace can have no provider configured. Ownership of the
-- provider (a user's own key vs a shared one) resolves through model_providers
-- and is deliberately not copied here — it can change hands, and a stale copy
-- would contradict the truth rather than preserve it.
ALTER TABLE workspace_usage_events
  ADD COLUMN IF NOT EXISTS provider_id text;

CREATE INDEX IF NOT EXISTS idx_wue_provider ON workspace_usage_events (provider_id)
  WHERE provider_id IS NOT NULL;
