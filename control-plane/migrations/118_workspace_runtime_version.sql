-- Cache the deployed runtime template version on the workspace row so that
-- "an update is available" becomes a pure DB comparison against
-- CURRENT_TEMPLATE_VERSION, instead of a live k8s read on every status
-- request. cp writes it when it creates/rebuilds the Deployment, and the
-- reconcile loop syncs it from the Deployment's workspace-version annotation
-- (which also backfills existing rows). NULL = unknown/legacy → no prompt.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS runtime_version integer;
