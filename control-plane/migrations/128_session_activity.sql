-- Session liveness heartbeat, split out of sessions.last_active_at.
--
-- `sessions.last_active_at` carries two unrelated signals: a durable "when did
-- this session last do anything" (session list ordering, admin weekly-active
-- aggregates, the daily-stats matviews) and a sub-minute liveness pulse used to
-- tell a working agent apart from a stalled one. The pulse was written every 10s
-- per live session, and because it lands on an indexed column of a wide row it
-- could never take the HOT path: each beat rewrote the whole sessions tuple and
-- all four of its indexes, through WAL and synchronous replication, to record a
-- fact that is worthless a minute later.
--
-- The pulse moves here. The durable column stays where it is and keeps advancing
-- on real events (message persist, turn start).
--
-- Deliberately no index on last_active_at. Readers filter it, but this table is
-- one narrow row per session and a seq scan is cheaper than what an index would
-- cost: indexing the written column is exactly what disqualified HOT on
-- `sessions`, and repeating that here would defeat the point of the split.
CREATE TABLE session_activity (
    session_id text PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);

-- No backfill. Readers coalesce to sessions.last_active_at when a session has no
-- row yet, so behaviour on the first deploy is identical to before and rows
-- appear as sessions become active.
