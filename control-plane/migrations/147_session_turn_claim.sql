-- One turn per session, held across control-plane replicas.
--
-- A session runs one turn at a time. The replica that admits a turn writes a
-- claim here and renews it while the turn runs; a chat request that finds a
-- live claim is refused. `turn_claim` identifies the holder, so a replica only
-- renews or releases its own claim. `turn_claim_expires_at` is a lease: a
-- replica that dies stops renewing, and the session frees itself.
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS turn_claim text,
    ADD COLUMN IF NOT EXISTS turn_claim_expires_at timestamp with time zone;
