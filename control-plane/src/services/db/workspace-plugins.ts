import { pool } from './pool'
import type { PluginMetadata } from './plugins'

/** A panel a workspace's installed plugin contributes to the app launcher.
 *  `label` is the static fallback shown before the bundle registers its own
 *  (i18n-capable) label(). */
export interface WorkspacePluginPanel {
  id: string
  label: string
}

/** One installed plugin, resolved to the panels it surfaces in a workspace.
 *  This is what the host needs to list extension apps — no mcp_config read. */
export interface WorkspacePluginEntry {
  plugin_id: string
  version: string
  panels: WorkspacePluginPanel[]
}

interface InstalledRow {
  id: string
  version: string
  metadata: PluginMetadata | null
  ui_panel: string | null
  catalog_label: string | null
}

/** Resolve an installed plugin's panels. A plugin that ships a manifest
 *  (`metadata.owns.panels`, e.g. citewright) is authoritative. Eager plugins
 *  with no manifest (reviewdeck/translation) fall back to the catalog's
 *  ui_panel as a single panel — the transitional bridge until ui_panel is
 *  dropped in the contract phase. */
function resolvePanels(row: InstalledRow): WorkspacePluginPanel[] {
  const declared = row.metadata?.owns?.panels
  if (declared && declared.length > 0) return declared
  if (row.ui_panel) {
    return [{ id: row.ui_panel, label: row.catalog_label ?? row.ui_panel }]
  }
  return []
}

/** Plugins installed in a workspace, resolved to launcher panels. Disabled
 *  (admin-toggled-off) plugins are excluded, matching getPluginBundle. */
export async function listWorkspacePlugins(workspaceId: string): Promise<WorkspacePluginEntry[]> {
  const { rows } = await pool.query<InstalledRow>(
    `SELECT p.id, p.version, p.metadata, mc.ui_panel, mc.label AS catalog_label
       FROM workspace_plugins wp
       JOIN plugins p ON p.id = wp.plugin_id AND p.enabled = true
       LEFT JOIN mcp_catalog mc ON mc.id = p.id
      WHERE wp.workspace_id = $1
      ORDER BY p.id`,
    [workspaceId],
  )
  return rows
    .map((row) => ({ plugin_id: row.id, version: row.version, panels: resolvePanels(row) }))
    .filter((e) => e.panels.length > 0)
}

/** Install a plugin into a workspace. Idempotent. Returns false when the
 *  plugin id is unknown or disabled (caller maps to 404). */
export async function installWorkspacePlugin(
  workspaceId: string,
  pluginId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO workspace_plugins (workspace_id, plugin_id)
     SELECT $1, p.id FROM plugins p WHERE p.id = $2 AND p.enabled = true
     ON CONFLICT DO NOTHING`,
    [workspaceId, pluginId],
  )
  if ((rowCount ?? 0) > 0) return true
  // 0 rows: either already installed (success) or plugin missing/disabled.
  const { rows } = await pool.query(
    'SELECT 1 FROM plugins WHERE id = $1 AND enabled = true',
    [pluginId],
  )
  return rows.length > 0
}

/** Uninstall a plugin from a workspace. Returns false if it wasn't installed. */
export async function uninstallWorkspacePlugin(
  workspaceId: string,
  pluginId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM workspace_plugins WHERE workspace_id = $1 AND plugin_id = $2',
    [workspaceId, pluginId],
  )
  return (rowCount ?? 0) > 0
}
