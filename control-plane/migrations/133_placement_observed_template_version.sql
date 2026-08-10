-- workspace_placements.observed_template_version: the pod-template version the
-- workload is actually built from, as reported by the runner.
--
-- Distinct from observed_version, which tracks convergence to a placement spec.
-- This one answers "is this workspace running an outdated pod template", which
-- is what drives `rebuild_available` in the API. cp caches it onto the workspace
-- row so that question stays a DB comparison instead of a live infra read.
--
-- Nullable: a backend that stamps no version, or a workspace with nothing
-- provisioned, reports none. Writes COALESCE onto the previous value so a
-- stopped workspace keeps its last known version rather than losing it.

ALTER TABLE workspace_placements
  ADD COLUMN IF NOT EXISTS observed_template_version int;
