-- Agent-to-agent calls whose result is delivered back to the caller.
--
-- `call_agent` writes one row per call it makes from a session that takes
-- deliveries. The row follows the called (child) session's turn: `status` is
-- the turn's outcome, and `delivery` is what became of the result on its way
-- back to the calling (parent) session. A result still `pending` is posted to
-- the parent session as a new turn once the parent is free, so the calling
-- agent does not have to poll for it.
--
-- status:   running | ended | failed
-- delivery: pending   - not handed to the parent yet
--           delivered - posted to the parent session as a turn
--           consumed  - the parent read it itself (inline tool result or
--                       get_agent_result)
--           dropped   - could not be delivered; `delivery_note` says why
--
-- `delivery_lease_expires_at` is held by the replica posting the result, so two
-- replicas never post the same one. `input_requested_at` marks a child parked
-- on a question to its user: the parent is told once (`input_notified_at`) and
-- the call stays open.
--
-- No FK to sessions: either session may be deleted while a call is open, and
-- the delivery then resolves the row instead of the delete being blocked.
CREATE TABLE IF NOT EXISTS public.agent_calls (
    id text PRIMARY KEY,
    parent_session_id text NOT NULL,
    parent_workspace_id text NOT NULL,
    child_session_id text NOT NULL,
    child_workspace_id text NOT NULL,
    caller_user_id text,
    status text NOT NULL DEFAULT 'running',
    error text,
    delivery text NOT NULL DEFAULT 'pending',
    delivery_note text,
    delivery_attempts integer NOT NULL DEFAULT 0,
    delivery_lease_expires_at timestamp with time zone,
    input_requested_at timestamp with time zone,
    input_notified_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    ended_at timestamp with time zone,
    delivered_at timestamp with time zone,
    CONSTRAINT agent_calls_status_check CHECK (status IN ('running', 'ended', 'failed')),
    CONSTRAINT agent_calls_delivery_check
        CHECK (delivery IN ('pending', 'delivered', 'consumed', 'dropped'))
);

CREATE INDEX IF NOT EXISTS idx_agent_calls_parent_pending
    ON public.agent_calls (parent_session_id) WHERE delivery = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_calls_child_running
    ON public.agent_calls (child_session_id) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_agent_calls_parent_delivered
    ON public.agent_calls (parent_session_id) WHERE delivery = 'delivered';
