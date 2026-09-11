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

-- Per-turn marker: which store (if any) this session's turn is reflecting
-- on. Lives on session_tokens, not sessions -- MCP tool registration already
-- resolves X-Session-Token via session_tokens on every request (see
-- lib/session-token.ts::resolveToken) to get session_id, so this rides the
-- same lookup for free instead of costing a second query against a niche
-- column on the much wider, much hotter `sessions` table. Set at mint time
-- (before the session even exists for a new session), not at bind time.
ALTER TABLE public.session_tokens
    ADD COLUMN IF NOT EXISTS reflect_store_id text REFERENCES public.memory_stores(id) ON DELETE SET NULL;
