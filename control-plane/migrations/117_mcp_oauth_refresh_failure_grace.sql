-- Hold an MCP OAuth token through a grace window before dropping it on refresh
-- failure. Upstream MCP brokers surface a *transient* failure to refresh the
-- underlying provider token (e.g. a TLS UNEXPECTED_EOF to googleapis.com) as an
-- `invalid_grant` 401, which cp previously treated as permanently dead and
-- deleted on the first occurrence — forcing the user to re-OAuth for a network
-- blip. These columns track consecutive refresh failures so we only delete +
-- prompt re-auth once the failures persist past the grace window; a successful
-- refresh resets both back to 0 / NULL.
ALTER TABLE public.mcp_oauth_tokens
  ADD COLUMN IF NOT EXISTS refresh_fail_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refresh_fail_first_at timestamp with time zone;
