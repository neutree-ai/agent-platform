CREATE SCHEMA IF NOT EXISTS browser;

-- Durable record of warm-pool instances claimed by a user.
--
-- The warm pool is reconcilable from sandbox-service on boot, but the claim map
-- (claimed instance -> owner) is not: sandbox metadata is immutable, so a
-- claimed warm instance keeps its `browser.pool=warm` tag forever and cannot be
-- stamped with an owner. Without this table a restart loses every claim, and
-- the pool must reap all warm instances on startup to avoid handing one user's
-- instance to another (fail closed). Persisting claims here lets startup keep
-- already-claimed instances alive and reap only genuine orphans.
CREATE TABLE browser.claims (
  sandbox_id  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX claims_user_idx ON browser.claims (user_id);
