-- Memory Reflect: periodic memory consolidation, triggered as a builtin
-- workspace schedule and executed by the workspace's own agent.
--
-- `schedules.reflect_store_id` marks a schedule as a builtin Reflect
-- schedule and names its target store; ON DELETE CASCADE removes the
-- schedule if its store is ever deleted.
ALTER TABLE public.schedules
    ADD COLUMN IF NOT EXISTS reflect_store_id text REFERENCES public.memory_stores(id) ON DELETE CASCADE;

-- Checkpoint + opt-in review gate live on the store, not the schedule --
-- they describe properties of the memory itself, independent of how a
-- Reflect run gets triggered.
ALTER TABLE public.memory_stores
    ADD COLUMN IF NOT EXISTS last_reflected_at timestamptz,
    ADD COLUMN IF NOT EXISTS reflect_review_mode boolean NOT NULL DEFAULT false;

-- Session-level marker: which store (if any) this session's turn is
-- reflecting on. Read by MCP tool registration, which only has session
-- context (not workspace-wide state) available per request.
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS reflect_store_id text REFERENCES public.memory_stores(id) ON DELETE SET NULL;

-- Workspace-level marker: set for the duration of a Reflect turn, cleared
-- on turn end. The memory-fuse write path authenticates as a workspace
-- (not a session), so actor_kind tagging on memory writes reads this
-- column rather than sessions.reflect_store_id.
ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS active_reflect_store_id text REFERENCES public.memory_stores(id) ON DELETE SET NULL;
