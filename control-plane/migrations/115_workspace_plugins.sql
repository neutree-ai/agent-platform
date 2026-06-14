-- UI plugin ↔ MCP decouple, Step 1: per-workspace plugin install table.
--
-- Before this, a plugin panel only appeared when the workspace had the
-- same-id MCP server enabled (`entry.id in mcp_config.mcpServers`, gated in
-- web/useWsApps.ts). That coupled panel visibility to MCP enablement, so a
-- pure UI plugin with no companion MCP could never show.
--
-- This table makes "installed in this workspace" an independent fact. The
-- gate moves off mcp_config and onto presence of a row here (membership =
-- installed, mirroring workspace_skills).
--
-- mcp_catalog.ui_panel is NOT dropped here — it stays as a panel-id lookup
-- for eager plugins that ship no manifest (reviewdeck/translation). Dropping
-- the column is the later contract phase (expand-and-contract).

CREATE TABLE IF NOT EXISTS workspace_plugins (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id    TEXT NOT NULL REFERENCES plugins(id)    ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, plugin_id)
);

-- Backfill: reproduce today's visibility so nothing regresses. For every
-- catalog entry that declares a ui_panel AND has a matching plugin bundle,
-- install it into each workspace whose mcp_config currently enables that
-- server. mcp_config is TEXT-encoded JSON written by the app, so ::jsonb is
-- safe; the `?` operator tests key presence in mcpServers.
INSERT INTO workspace_plugins (workspace_id, plugin_id)
SELECT wc.workspace_id, p.id
FROM workspace_config wc
JOIN mcp_catalog mc ON mc.ui_panel IS NOT NULL
JOIN plugins p ON p.id = mc.id
WHERE (wc.mcp_config::jsonb -> 'mcpServers') ? mc.id
ON CONFLICT DO NOTHING;
