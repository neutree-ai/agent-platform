-- The meter writes and reads the log by workspace, so migration 134 indexed it
-- that way. The resource summary reads it by user: one query per page view
-- walking every interval that user's workspaces ever had. Without this it is a
-- sequential scan of the whole log, which grows for every workspace on the
-- platform rather than just the reader's own.
--
-- Ordered by ts so the LEAD() over each workspace's rows can be fed in order,
-- and covering the columns the interval math needs so the scan stays index-only.
CREATE INDEX IF NOT EXISTS idx_wre_user_ts
  ON workspace_runtime_events (user_id, workspace_id, ts, id)
  INCLUDE (phase, ready_replicas, resources);

-- "Last used" is GREATEST(created, newest session, newest message) per
-- workspace. The messages side already has (workspace_id, created_at); the
-- sessions side only had the two columns indexed separately, so MAX(last_active_at)
-- for one workspace scanned the global last_active_at index backwards until it
-- happened to hit a row for that workspace — ~38ms per workspace, and the idle
-- GC pays it for every running workspace on the platform every hour.
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_last_active
  ON sessions (workspace_id, last_active_at DESC);
