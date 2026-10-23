-- The account an application (oauth_clients) owns its content under.
--
-- Prompts and skills an application publishes through /apps/v1 belong to this
-- account. It is a system account (role 'system', so it can't sign in and is
-- left out of user listings) with managed_by set to the application, one per
-- application. It is a member of the application's team, so what it owns can
-- be shared with that team like anyone else's.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_app_owner
    ON public.users (managed_by) WHERE role = 'system';

INSERT INTO public.users (id, username, display_name, role, managed_by)
SELECT substr(md5(random()::text || c.id), 1, 8), 'app/' || c.id, c.name, 'system', c.id
  FROM public.oauth_clients c
 WHERE NOT EXISTS (
         SELECT 1 FROM public.users u WHERE u.managed_by = c.id AND u.role = 'system'
       );

INSERT INTO public.team_members (team_id, user_id, role)
SELECT t.id, u.id, 'member'
  FROM public.teams t
  JOIN public.users u ON u.managed_by = t.app_id AND u.role = 'system'
ON CONFLICT (team_id, user_id) DO NOTHING;
