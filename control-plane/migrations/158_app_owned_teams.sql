-- Teams an application creates for its own users.
--
-- Besides its own team (teams.app_id), an application may group its users into
-- teams of its own, named by its own id for each (`external_id`), for instance
-- one per organization in the application. Only that application's users are
-- members, and the application alone manages them, through /apps/v1/teams. A
-- user shares a folder with such a team the way they would with any team.
--
-- Its own team stays the one an administrator shares providers, skills,
-- prompts, environments and templates with; these teams only carry what the
-- application's users share among themselves.
ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS owner_app_id text REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_owner_app_external_id;
ALTER TABLE public.teams
    ADD CONSTRAINT teams_owner_app_external_id
        CHECK ((owner_app_id IS NULL) = (external_id IS NULL) AND (owner_app_id IS NULL OR app_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS teams_owner_app_external_id_idx
    ON public.teams (owner_app_id, external_id) WHERE owner_app_id IS NOT NULL;
