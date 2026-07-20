-- Session → replica affinity for auto-scaling workspaces.
-- When a workspace runs more than one replica (all sharing the same RWX
-- workspace volume), a session's turns must keep hitting the SAME replica: the
-- turn is a long-lived SSE to one agent process, and its transcript file must
-- not be appended by two replicas at once. This pins the session to the
-- provider-assigned replica id it was routed to.
-- NULL for every static (single-replica) session — the routing seam resolves a
-- NULL binding to the workspace's default address, byte-identical to before.
-- No FK / no default: it is runtime routing state, not a modeled relation.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS replica_ordinal int;
