-- Internal cache; public statistics keep their existing names and columns.
CREATE TABLE public.admin_workspace_daily_interactions (
  workspace_id text NOT NULL,
  day date,
  interactions bigint NOT NULL,
  UNIQUE NULLS NOT DISTINCT (day, workspace_id)
);

-- A token watermark can already exist when this cache is introduced, including
-- on an empty database. Initialize it independently on the next scheduler tick.
ALTER TABLE public.admin_stats_watermark
  ADD COLUMN workspace_daily_initialized boolean NOT NULL DEFAULT false;
