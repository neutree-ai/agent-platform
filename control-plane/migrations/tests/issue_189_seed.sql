-- Run after 001_init.sql and before 141_message_event_count.sql on a disposable DB.
INSERT INTO public.users (id, username, display_name)
VALUES ('__issue_189_historic_user', '__issue_189_historic_user', 'Issue 189 historical test');
INSERT INTO public.workspaces (id, user_id, name, created_at)
VALUES ('__issue_189_historic_workspace', '__issue_189_historic_user', 'Issue 189 historical test', now() - interval '1 day');
INSERT INTO public.sessions (id, workspace_id, created_at)
VALUES ('__issue_189_historic_session', '__issue_189_historic_workspace', now() - interval '1 day');
INSERT INTO public.messages (id, workspace_id, session_id, role, created_at)
VALUES ('__issue_189_historic_message', '__issue_189_historic_workspace', '__issue_189_historic_session', 'assistant', now() - interval '1 day');
INSERT INTO public.session_events (id, message_id, session_id, kind, payload)
VALUES ('__issue_189_historic_event_1', '__issue_189_historic_message', '__issue_189_historic_session', 'text', '{}'),
       ('__issue_189_historic_event_2', '__issue_189_historic_message', '__issue_189_historic_session', 'text', '{}');
