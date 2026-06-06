CREATE SCHEMA IF NOT EXISTS sandbox;

CREATE TABLE sandbox.launches (
  sandbox_id      TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  image           TEXT NOT NULL,
  resource        JSONB NOT NULL DEFAULT '{}'::jsonb,
  entrypoint      TEXT[],
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  renew_count     INTEGER NOT NULL DEFAULT 0,
  last_renewed_at TIMESTAMPTZ
);

CREATE INDEX launches_owner_created_idx
  ON sandbox.launches (owner_id, created_at DESC);
