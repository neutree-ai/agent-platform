-- Each application (oauth_clients) has a team of its own.
--
-- Its users are members, and so is whoever registered the application, as the
-- team's admin. A provider, skill, prompt, environment or template shared with
-- that team is available to the application's users, the same way sharing
-- with any team works. The team is named after the application and goes away
-- with it; its users' memberships are kept by the platform.
--
-- This replaces the teams an application used to declare
-- (oauth_client_teams): an application's users now join only its own team.
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS app_id text UNIQUE REFERENCES public.oauth_clients(id) ON DELETE CASCADE;

INSERT INTO public.teams (id, name, description, created_by, app_id)
SELECT substr(md5(random()::text || c.id), 1, 8), c.name, c.description, c.created_by, c.id
  FROM public.oauth_clients c
 WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.app_id = c.id);

INSERT INTO public.team_members (team_id, user_id, role)
SELECT t.id, t.created_by, 'admin'
  FROM public.teams t
 WHERE t.app_id IS NOT NULL
ON CONFLICT (team_id, user_id) DO NOTHING;

INSERT INTO public.team_members (team_id, user_id, role)
SELECT t.id, u.id, 'member'
  FROM public.teams t
  JOIN public.users u ON u.managed_by = t.app_id
ON CONFLICT (team_id, user_id) DO NOTHING;

DELETE FROM public.team_members m
 USING public.oauth_client_teams ct, public.users u
 WHERE m.team_id = ct.team_id
   AND m.user_id = u.id
   AND u.managed_by = ct.client_id;

DROP TABLE IF EXISTS public.oauth_client_teams;
