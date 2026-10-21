-- Users that an application (oauth_clients) provisions and acts for.
--
-- An application keeps its own set of users: one NAP user per end user of the
-- app, even when the same person also has a NAP account or uses another app.
-- `managed_by` marks such a user. They have no password and cannot sign in to
-- NAP itself; the application obtains short-lived tokens for them instead.
--
-- The application's own id for the user lives in user_identities under the
-- provider `app:<client_id>`, which gives the (provider, external_id) lookup
-- and uniqueness the upsert needs.
--
-- RESTRICT: an application can't be deleted while it still has users, so its
-- users are never left without anyone able to act for them.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS managed_by text REFERENCES public.oauth_clients(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_users_managed_by ON public.users (managed_by) WHERE managed_by IS NOT NULL;

-- Teams an application declares for its users. Every user of the application
-- is a member of exactly these teams (role `member`); changing the list adds
-- or removes the memberships of all its users.
CREATE TABLE IF NOT EXISTS public.oauth_client_teams (
    client_id text NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    PRIMARY KEY (client_id, team_id)
);
