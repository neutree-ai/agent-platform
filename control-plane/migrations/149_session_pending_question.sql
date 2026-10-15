-- The question a session's agent asked its user and is waiting on, as the
-- `question.requested` event carried it: `{ "request_id": …, "questions": [] }`.
--
-- chat_status is `human` both when a turn has ended and when the agent asked
-- something mid-turn; this tells the two apart, and carries the question so a
-- client need not ask the agent for it. Set when the event passes through the
-- control plane; cleared when the question is answered and whenever
-- chat_status moves on.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS pending_question jsonb;
