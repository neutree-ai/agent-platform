import { pool } from './pool'

/** Declares what surfaces a lazy plugin owns so the host can map
 *  panel-id / tool-renderer-name / tool-handler-pattern → pluginId and
 *  trigger an on-demand bundle load per surface. NULL/absent ⇒ plugin
 *  is eager (loaded at boot, today's default behaviour). */
export interface PluginMetadata {
  /** When true, host doesn't inject the bundle script at boot. Defaults
   *  to false (eager) if metadata is null. */
  lazy?: boolean
  owns?: {
    /** Panel descriptors. `label` is the static string shown in the app
     *  launcher / tab before the bundle loads; once the bundle's
     *  `registerPanel` runs, its `label()` callback supersedes (allows
     *  per-render i18n). */
    panels?: { id: string; label: string }[]
    /** Canonical tool names (after MCP prefix stripping) the plugin's
     *  `registerToolRenderer` will provide. */
    toolRenderers?: string[]
    /** Tool-result handler descriptors. `pattern` is a string compiled
     *  to a case-insensitive RegExp host-side; matched against the
     *  inbound tool name to demand-load the plugin. */
    toolHandlers?: { id: string; pattern: string }[]
  }
}

interface PluginRow {
  id: string
  version: string
  enabled: boolean
  description: string | null
  bundle_size: number
  metadata: PluginMetadata | null
  created_at: string
  updated_at: string
}

export async function listPlugins(opts: { enabledOnly?: boolean } = {}): Promise<PluginRow[]> {
  const where = opts.enabledOnly ? 'WHERE enabled = true' : ''
  const { rows } = await pool.query(
    `SELECT id, version, enabled, description, bundle_size, metadata, created_at, updated_at
     FROM plugins ${where} ORDER BY id`,
  )
  return rows as PluginRow[]
}

export async function getPluginBundle(
  id: string,
): Promise<{ version: string; bundle: Buffer } | null> {
  const { rows } = await pool.query<{ version: string; bundle: Buffer }>(
    'SELECT version, bundle FROM plugins WHERE id = $1 AND enabled = true',
    [id],
  )
  return rows[0] ?? null
}

export async function upsertPlugin(input: {
  id: string
  version: string
  description: string | null
  bundle: Buffer
  metadata: PluginMetadata | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO plugins (id, version, description, bundle, bundle_size, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       version = EXCLUDED.version,
       description = EXCLUDED.description,
       bundle = EXCLUDED.bundle,
       bundle_size = EXCLUDED.bundle_size,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      input.id,
      input.version,
      input.description,
      input.bundle,
      input.bundle.byteLength,
      input.metadata,
    ],
  )
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE plugins SET enabled = $1, updated_at = now() WHERE id = $2',
    [enabled, id],
  )
  return (rowCount ?? 0) > 0
}

export async function deletePlugin(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM plugins WHERE id = $1', [id])
  return (rowCount ?? 0) > 0
}
