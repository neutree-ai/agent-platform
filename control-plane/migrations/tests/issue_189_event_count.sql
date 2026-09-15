-- Run on a disposable DB after issue_189_seed.sql and migrations 141-143.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF (SELECT event_count FROM public.messages WHERE id = '__issue_189_historic_message') IS DISTINCT FROM 2
     OR (SELECT interactions FROM public.admin_workspace_stats WHERE workspace_id = '__issue_189_historic_workspace') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'historical migration backfill or view count failed';
  END IF;
END;
$$;

INSERT INTO public.users (id, username, display_name)
VALUES ('__issue_189_user', '__issue_189_user', 'Issue 189 test');
INSERT INTO public.workspaces (id, user_id, name)
VALUES ('__issue_189_workspace', '__issue_189_user', 'Issue 189 test');
INSERT INTO public.sessions (id, workspace_id)
VALUES ('__issue_189_session', '__issue_189_workspace');
INSERT INTO public.messages (id, workspace_id, session_id, role)
VALUES ('__issue_189_user_message', '__issue_189_workspace', '__issue_189_session', 'user'),
       ('__issue_189_assistant_message', '__issue_189_workspace', '__issue_189_session', 'assistant');

INSERT INTO public.session_events (id, message_id, session_id, kind, payload)
VALUES ('__issue_189_event_1', '__issue_189_assistant_message', '__issue_189_session', 'text', '{}'),
       ('__issue_189_event_2', '__issue_189_assistant_message', '__issue_189_session', 'text', '{}');

-- Simulate events predating the counter, then exercise the actual backfill.
UPDATE public.messages SET event_count = 0 WHERE id = '__issue_189_assistant_message';
\ir ../142_backfill_message_event_count.sql

INSERT INTO public.session_events (id, message_id, session_id, kind, payload)
VALUES ('__issue_189_event_3', '__issue_189_assistant_message', '__issue_189_session', 'text', '{}');
INSERT INTO public.session_events (id, message_id, session_id, kind, payload)
VALUES ('__issue_189_event_3', '__issue_189_assistant_message', '__issue_189_session', 'text', '{}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.session_events (id, message_id, session_id, kind, payload)
VALUES ('__issue_189_event_3', '__issue_189_assistant_message', '__issue_189_session', 'text', '{"updated":true}')
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;
DELETE FROM public.session_events WHERE id = '__issue_189_event_1';

DO $$
BEGIN
  IF (SELECT event_count FROM public.messages WHERE id = '__issue_189_assistant_message') IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'insert/conflict/update/delete event count drifted';
  END IF;
END;
$$;

REFRESH MATERIALIZED VIEW public.admin_workspace_stats;
REFRESH MATERIALIZED VIEW public.admin_daily_stats;
REFRESH MATERIALIZED VIEW public.user_daily_interactions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews
              WHERE matviewname IN ('admin_workspace_stats', 'admin_daily_stats', 'user_daily_interactions')
                AND definition LIKE '%session_events%') THEN
    RAISE EXCEPTION 'one of the three views still scans session_events';
  END IF;
  IF (SELECT interactions FROM public.admin_workspace_stats WHERE workspace_id = '__issue_189_workspace') IS DISTINCT FROM 4
     OR (SELECT interactions FROM public.admin_daily_stats WHERE date::date = current_date) IS DISTINCT FROM 4
     OR (SELECT interactions FROM public.user_daily_interactions WHERE user_id = '__issue_189_user' AND day = current_date) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'materialized view interaction counts differ';
  END IF;
END;
$$;

ROLLBACK;

REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_workspace_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_daily_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_daily_interactions;
