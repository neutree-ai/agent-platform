-- Follow-ups submitted by connectors are separate from the editable web draft.
CREATE TABLE session_message_queue (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  delivery_token TEXT,
  delivery_expires_at TIMESTAMPTZ,
  UNIQUE (session_id, request_key)
);

CREATE INDEX session_message_queue_pending
  ON session_message_queue (session_id, id) WHERE delivered_at IS NULL;
