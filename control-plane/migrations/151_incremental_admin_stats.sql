-- Preserve populated snapshots so reads remain available until the new scheduler runs.
DO $$
DECLARE
  relation_name text;
  populated boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'admin_workspace_stats', 'admin_daily_stats', 'user_daily_interactions',
    'admin_token_user_stats', 'admin_token_workspace_stats', 'admin_token_daily_stats'
  ] LOOP
    SELECT ispopulated INTO STRICT populated FROM pg_matviews
     WHERE schemaname = 'public' AND matviewname = relation_name;
    EXECUTE format('CREATE TABLE public.%I AS SELECT * FROM public.%I WITH NO DATA', relation_name || '_new', relation_name);
    IF populated THEN
      EXECUTE format('INSERT INTO public.%I SELECT * FROM public.%I', relation_name || '_new', relation_name);
    END IF;
    EXECUTE format('DROP MATERIALIZED VIEW public.%I', relation_name);
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', relation_name || '_new', relation_name);
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX admin_workspace_stats_ws_id ON public.admin_workspace_stats (workspace_id);
CREATE UNIQUE INDEX admin_daily_stats_date ON public.admin_daily_stats (date);
CREATE UNIQUE INDEX user_daily_interactions_user_day ON public.user_daily_interactions (user_id, day);
CREATE INDEX user_daily_interactions_day ON public.user_daily_interactions (day);
CREATE UNIQUE INDEX admin_token_user_stats_user ON public.admin_token_user_stats (user_id);
CREATE UNIQUE INDEX admin_token_workspace_stats_ws ON public.admin_token_workspace_stats (workspace_id);
CREATE UNIQUE INDEX admin_token_daily_stats_day ON public.admin_token_daily_stats (day);

-- The first scheduler refresh rebuilds all snapshots before creating this singleton row.
CREATE TABLE public.admin_stats_watermark (
  id integer PRIMARY KEY CHECK (id = 1),
  last_usage_id bigint NOT NULL
);

CREATE INDEX idx_wue_created_at_id ON public.workspace_usage_events (created_at, id);
