-- Shared folders granted to teams.
--
-- A row lets every member of `team_id` mount the folder in their own
-- workspaces, at up to `permission`. The grant only allows it: a member mounts
-- the folder into a workspace when they choose to, and that mount is an
-- afs_share_members row with source 'team'. The folder's owner may only grant
-- to a team they belong to; leaving the team drops the grant (see
-- services/db/teams.ts removeTeamMember).
CREATE TABLE IF NOT EXISTS public.afs_share_grants (
    share_id text NOT NULL REFERENCES public.afs_shares(id) ON DELETE CASCADE,
    team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    permission text NOT NULL CHECK (permission IN ('read_only', 'read_write')),
    granted_by text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (share_id, team_id)
);

CREATE INDEX IF NOT EXISTS afs_share_grants_team_idx ON public.afs_share_grants (team_id);

-- How a member came to have the folder. 'direct': the owner, a grant to one of
-- the owner's own workspaces, teamwork, or an application's spec. 'team': a
-- member of a team the folder is granted to mounted it; such a mount lasts only
-- while a grant to one of the workspace owner's teams allows it.
ALTER TABLE public.afs_share_members
    ADD COLUMN IF NOT EXISTS source text DEFAULT 'direct' NOT NULL
        CHECK (source IN ('direct', 'team'));

-- Where the folder is mounted in the member's workspace, /mnt/afs/<mount_name>.
-- The folder's own name, except for a team mount, which may choose another,
-- since folders of different owners can share a name.
ALTER TABLE public.afs_share_members ADD COLUMN IF NOT EXISTS mount_name text;
UPDATE public.afs_share_members m SET mount_name = s.name
  FROM public.afs_shares s
 WHERE s.id = m.share_id AND m.mount_name IS NULL;
ALTER TABLE public.afs_share_members ALTER COLUMN mount_name SET NOT NULL;
