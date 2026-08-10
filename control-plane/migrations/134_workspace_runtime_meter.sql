-- Runtime metering: an append-only state log of what each workspace was observed
-- to be, and the coverage windows of the pass that writes it.
--
-- The log is raw: it records observations verbatim and derives nothing. Rounding,
-- which replica count is billable, whether an errored pod is charged for, and any
-- price at all belong to a rating layer built on top, so pricing can change and be
-- recomputed without rewriting history.
--
-- No foreign key to workspaces, and user_id denormalised onto the row: a ledger
-- has to outlive the workspace it accounts for. workspace_usage_events (the token
-- ledger) is built the same way for the same reason.

CREATE TABLE IF NOT EXISTS workspace_runtime_events (
  id                        bigserial   PRIMARY KEY,
  workspace_id              text        NOT NULL,
  user_id                   text        NOT NULL,
  -- When the workspace entered this state. An interval runs from one row to the
  -- next row for the same workspace; there is no closing row to pair with, so a
  -- crash between the two can never leave a half-written interval behind.
  ts                        timestamptz NOT NULL,
  -- The phase the runner reported, not the status cp exposes. 'unknown' is a
  -- genuine value: cp has no observation, which is different from 'stopped'.
  -- 'deleted' is written by the orphan sweep when a placement is gone.
  phase                     text        NOT NULL,
  -- Replicas actually ready, and the count the spec asks for. Both, because
  -- which of them is billable is a pricing question, not a metering one — during
  -- a scale-up they disagree for as long as the new pods take to become ready.
  -- ready_replicas is null when the runner reported no ready set at all, which
  -- is not the same as reporting an empty one.
  ready_replicas            integer,
  desired_replicas          integer     NOT NULL,
  runtime_mode              text        NOT NULL,
  -- Sizing at the time, so a later resize cannot reprice a past interval.
  resources                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- The spec cp wants, and the pod template actually running. A resize advances
  -- the first immediately and the second only once the runner has re-applied, so
  -- keeping both lets rating charge for the size that was really deployed.
  spec_version              integer,
  observed_template_version integer,
  -- True when the workspace's environment had no live runner: the phase on this
  -- row is the last thing anyone saw, not a current observation.
  env_offline               boolean     NOT NULL DEFAULT false,

  -- Both enumerations mirror a TypeScript type: MeterPhase (= ObservedPhase plus
  -- the terminal 'deleted') and RuntimeMode. Adding a variant to either type
  -- without adding it here fails at insert time inside a cron, so change both.
  CONSTRAINT workspace_runtime_events_phase_check
    CHECK (phase IN ('pending', 'starting', 'running', 'stopped', 'error', 'unknown', 'deleted')),
  CONSTRAINT workspace_runtime_events_runtime_mode_check
    CHECK (runtime_mode IN ('static', 'auto-scaling'))
);

-- The meter's hot read: the newest row for one workspace, once per workspace per
-- pass. INCLUDE carries every column that read needs, so it stays an index-only
-- scan instead of a heap fetch per workspace every 15 seconds.
CREATE INDEX IF NOT EXISTS idx_wre_workspace_ts
  ON workspace_runtime_events (workspace_id, ts DESC, id DESC)
  INCLUDE (phase, ready_replicas, desired_replicas, spec_version,
           observed_template_version, env_offline);

-- When the meter was running. An interval in the log stays open until the next
-- row, so a stretch where cp was down would otherwise be indistinguishable from
-- a workspace that genuinely stayed running. The gap between one window's
-- covered_through and the next window's started_at is exactly the time the meter
-- observed nothing, and rating decides what to do with it.
CREATE TABLE IF NOT EXISTS runtime_meter_windows (
  id              bigserial   PRIMARY KEY,
  started_at      timestamptz NOT NULL,
  covered_through timestamptz NOT NULL
);
