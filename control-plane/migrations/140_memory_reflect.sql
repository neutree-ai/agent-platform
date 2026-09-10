-- Memory Reflect: periodic memory consolidation, triggered as a builtin
-- workspace schedule and executed by the workspace's own agent.
--
-- A third `schedules.origin` value: like 'template', its content is
-- platform-governed (here: the prompt, continuously reconciled -- see
-- reconcileReflectSchedule) rather than user-authored, and it cannot be
-- deleted (disable instead). Unlike 'template' it is NOT swept by
-- reconcileTemplateSchedules -- that function matches schedules by name
-- against a template version's schedule defs and deletes ones it can't
-- find, which would silently kill a Reflect schedule the first time the
-- workspace's template version bumped.
ALTER TABLE public.schedules
    DROP CONSTRAINT IF EXISTS schedules_origin_check,
    ADD CONSTRAINT schedules_origin_check CHECK (origin = ANY (ARRAY['local'::text, 'template'::text, 'reflect'::text]));
--
-- `memory_stores.reflect_schedule_id` marks a store as having a builtin
-- Reflect schedule and names it. The link lives on the store, not on
-- `schedules` -- `schedules` stays a generic "cron/one-shot -> workspace
-- chat" primitive shared with template and user-created schedules, with no
-- awareness of Reflect. UNIQUE because the relationship is 1:1; ON DELETE
-- SET NULL because deleting the schedule (e.g. the user detaches it some
-- other way) shouldn't delete the store it describes.
--
-- Checkpoint + opt-in review gate live on the store for the same reason --
-- they describe properties of the memory itself, independent of how a
-- Reflect run gets triggered.
ALTER TABLE public.memory_stores
    ADD COLUMN IF NOT EXISTS reflect_schedule_id uuid UNIQUE REFERENCES public.schedules(id) ON DELETE SET NULL,
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
