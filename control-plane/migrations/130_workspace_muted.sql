-- Per-workspace "mute": when true, a session that ends normally lands in
-- 'idle' instead of 'human', so it never joins the drain queue / unread
-- counts, and the agent.task_done notification is suppressed. Default false
-- keeps existing workspaces on the attention-seeking behaviour.
ALTER TABLE public.workspace_config
    ADD COLUMN IF NOT EXISTS muted boolean DEFAULT false NOT NULL;
