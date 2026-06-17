-- Speed up listIdleRunningWorkspaces: the idle-GC query runs
-- `SELECT MAX(m.created_at) FROM messages m WHERE m.workspace_id = w.id`
-- for every running workspace. Without this index it scans all 100k+ rows
-- and filters by workspace_id, averaging ~5s per GC call.
-- With (workspace_id, created_at DESC) Postgres uses an index-only scan
-- returning the single latest row per workspace.
CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
  ON messages(workspace_id, created_at DESC);
