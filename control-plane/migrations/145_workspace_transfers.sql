-- Workspace ownership transfer.
--
-- A transfer moves a workspace from one user to another outright: the new
-- owner gets it, the old owner keeps no access. A user-initiated transfer is a
-- handshake — it sits `pending` until the recipient accepts or declines, the
-- sender cancels, or it expires. An admin-initiated transfer is executed
-- directly and is recorded here all the same, so every ownership change leaves
-- one row behind: this table is the audit trail for them.
--
-- `options` holds what the initiator chose when starting the transfer (which
-- of their private prompts / skills to copy to the recipient) and is replayed
-- verbatim at execution. `manifest` is the plan that actually ran, snapshotted
-- when the transfer completes.
CREATE TABLE IF NOT EXISTS public.workspace_transfers (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    from_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    to_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    initiated_by text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    manifest jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT workspace_transfers_status_check CHECK ((status = ANY (ARRAY[
      'pending'::text, 'executing'::text, 'completed'::text, 'declined'::text,
      'cancelled'::text, 'expired'::text, 'failed'::text
    ])))
);

-- At most one open transfer per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_transfers_open_uniq
    ON public.workspace_transfers (workspace_id)
    WHERE status = ANY (ARRAY['pending'::text, 'executing'::text]);

CREATE INDEX IF NOT EXISTS workspace_transfers_to_user_idx
    ON public.workspace_transfers (to_user_id, status);

-- The workspace a memory store was provisioned for, if any.
--
-- Creating a workspace also creates a store for it (routes/workspaces/write.ts).
-- That store is the workspace's own memory, so it changes hands with the
-- workspace; stores the owner created separately and attached do not. Nothing
-- else distinguishes the two, hence the column.
ALTER TABLE public.memory_stores
    ADD COLUMN IF NOT EXISTS origin_workspace_id text REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Backfill. A provisioned store is created by the same request as its
-- workspace, for the same owner, and attached to it — so for each workspace,
-- take the attached store of the same owner created closest to it, within a
-- minute. Stores attached later from the Memory app miss the window.
UPDATE public.memory_stores ms
   SET origin_workspace_id = pick.workspace_id
  FROM (
    SELECT DISTINCT ON (w.id) w.id AS workspace_id, s.id AS store_id
      FROM public.workspaces w
      JOIN public.workspace_memory_attachments a ON a.workspace_id = w.id
      JOIN public.memory_stores s ON s.id = a.store_id AND s.owner_user_id = w.user_id
     WHERE s.created_at BETWEEN w.created_at - interval '1 minute' AND w.created_at + interval '1 minute'
     ORDER BY w.id, abs(extract(epoch FROM s.created_at - w.created_at))
  ) pick
 WHERE ms.id = pick.store_id
   AND ms.origin_workspace_id IS NULL;
