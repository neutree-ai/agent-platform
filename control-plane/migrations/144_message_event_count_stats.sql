-- Materialized views cannot be CREATE OR REPLACE'd. Rebuild them in this
-- transaction, populated and with the indexes needed for concurrent refresh.
DROP MATERIALIZED VIEW public.admin_daily_stats;
DROP MATERIALIZED VIEW public.admin_workspace_stats;
DROP MATERIALIZED VIEW public.user_daily_interactions;

CREATE MATERIALIZED VIEW public.admin_daily_stats AS
 SELECT d.date,
    COALESCE(w.count, 0) AS new_workspaces,
    COALESCE(s.count, 0) AS new_sessions,
    COALESCE(m.interactions, 0) AS interactions,
    COALESCE(a.count, 0) AS active_workspaces
   FROM ((((generate_series((( SELECT (min(workspaces.created_at))::date AS min
           FROM public.workspaces))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d(date)
     LEFT JOIN ( SELECT (date_trunc('day'::text, workspaces.created_at))::date AS day,
            (count(*))::integer AS count
           FROM public.workspaces
          GROUP BY ((date_trunc('day'::text, workspaces.created_at))::date)) w ON ((w.day = (d.date)::date)))
     LEFT JOIN ( SELECT (date_trunc('day'::text, sessions.created_at))::date AS day,
            (count(*))::integer AS count
           FROM public.sessions
          GROUP BY ((date_trunc('day'::text, sessions.created_at))::date)) s ON ((s.day = (d.date)::date)))
     LEFT JOIN ( SELECT (date_trunc('day'::text, m_1.created_at))::date AS day,
            ((count(*) FILTER (WHERE (m_1.role = 'user'::text)) + COALESCE(sum(m_1.event_count) FILTER (WHERE (m_1.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
           FROM public.messages m_1
          GROUP BY ((date_trunc('day'::text, m_1.created_at))::date)) m ON ((m.day = (d.date)::date)))
     LEFT JOIN ( SELECT (d2.date)::date AS day,
            (count(DISTINCT s2.workspace_id))::integer AS count
           FROM (generate_series((( SELECT (min(workspaces.created_at))::date AS min
                   FROM public.workspaces))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d2(date)
             JOIN public.sessions s2 ON (((s2.last_active_at >= ((d2.date)::date - '6 days'::interval)) AND (s2.last_active_at < ((d2.date)::date + '1 day'::interval)))))
          GROUP BY d2.date) a ON ((a.day = (d.date)::date)))
  WITH DATA;

CREATE UNIQUE INDEX admin_daily_stats_date ON public.admin_daily_stats USING btree (date);

CREATE MATERIALIZED VIEW public.admin_workspace_stats AS
 SELECT m.workspace_id,
    ((count(*) FILTER (WHERE (m.role = 'user'::text)) + COALESCE(sum(m.event_count) FILTER (WHERE (m.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
   FROM public.messages m
  GROUP BY m.workspace_id
  WITH DATA;

CREATE UNIQUE INDEX admin_workspace_stats_ws_id ON public.admin_workspace_stats USING btree (workspace_id);

CREATE MATERIALIZED VIEW public.user_daily_interactions AS
 SELECT w.user_id,
    (date_trunc('day'::text, m.created_at))::date AS day,
    ((count(*) FILTER (WHERE (m.role = 'user'::text)) + COALESCE(sum(m.event_count) FILTER (WHERE (m.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
   FROM ((public.messages m
     JOIN public.sessions s ON ((s.id = m.session_id)))
     JOIN public.workspaces w ON ((w.id = s.workspace_id)))
  GROUP BY w.user_id, ((date_trunc('day'::text, m.created_at))::date)
  WITH DATA;

CREATE INDEX user_daily_interactions_day ON public.user_daily_interactions USING btree (day);
CREATE UNIQUE INDEX user_daily_interactions_user_day ON public.user_daily_interactions USING btree (user_id, day);
