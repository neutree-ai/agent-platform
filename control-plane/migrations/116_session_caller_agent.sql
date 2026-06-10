-- Track which agent invoked a session via agent-to-agent (call_agent).
-- Mirrors the existing `caller_user_id` (user-initiated) for the agent-initiated
-- case: when `source = 'agent'`, this points at the calling agent's workspace so
-- the session view can surface "invoked by <agent>". NULL for user/web/channel
-- sessions. No FK — a caller workspace may be deleted later; the column then
-- simply resolves to no badge rather than blocking the delete.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS caller_workspace_id text;
