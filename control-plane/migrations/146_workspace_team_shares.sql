-- Workspace sharing with teams.
--
-- A row grants every member of `team_id` access to the workspace: they can
-- chat in any of its sessions and manage its configuration. The agent keeps
-- running as the owner — owner credentials, owner usage — so sharing is a
-- delegation, not a change of identity. Deleting, transferring and sharing the
-- workspace stay with the owner.
--
-- The owner may only share with a team they belong to; leaving the team drops
-- the row (see services/db/teams.ts removeTeamMember).
CREATE TABLE IF NOT EXISTS public.workspace_team_shares (
    workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    created_by text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, team_id)
);

CREATE INDEX IF NOT EXISTS workspace_team_shares_team_idx
    ON public.workspace_team_shares (team_id);

-- Who wrote a user message. Several people can speak in a shared workspace's
-- session, so the session's caller no longer identifies the author. Null for
-- assistant messages and for rows written before the column existed.
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS author_user_id text REFERENCES public.users(id) ON DELETE SET NULL;
