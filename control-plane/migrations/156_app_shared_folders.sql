-- The shared folders each user of an application has because its spec
-- declares them (shared_folders). A folder is an afs share owned by the
-- user's workspace for the folder's owner agent; a row here marks a share the
-- spec made, so a folder the spec drops is revoked and no other share is
-- touched. Its application is its owner workspace's (app_workspaces). A share
-- that goes away (its owner workspace deleted, or revoked by hand) takes its
-- row with it, and is made again while the spec declares it.
CREATE TABLE IF NOT EXISTS public.app_shared_folders (
    share_id text PRIMARY KEY REFERENCES public.afs_shares(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Why the workspace's shared folders can't be brought in line with the spec,
-- while they can't. Kept apart from `blocked`, which the workspace following
-- its agent's template sets and clears.
ALTER TABLE public.app_workspaces ADD COLUMN IF NOT EXISTS folders_blocked text;
