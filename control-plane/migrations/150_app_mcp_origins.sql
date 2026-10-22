-- MCP servers an application (oauth_clients) runs for its users.
--
-- A workspace's MCP traffic to one of these origins goes through cp, which
-- attaches a signed statement of who is calling (user, workspace, session)
-- addressed to the declaring application. An origin belongs to at most one
-- application, so the statement has exactly one audience.
CREATE TABLE IF NOT EXISTS public.oauth_client_mcp_origins (
    origin text PRIMARY KEY,
    client_id text NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_client_mcp_origins_client ON public.oauth_client_mcp_origins (client_id);
