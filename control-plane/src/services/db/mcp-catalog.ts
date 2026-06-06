import { pool } from './pool'

export interface McpCatalogHooks {
  on_delete?: string
}

export interface McpCatalogEntry {
  id: string
  label: string
  description: string
  url: string
  saas_url: string | null
  group: string
  ui_panel: string | null
  required: boolean
  params: { header: string; label: string; type: string; default: string }[]
  hooks: McpCatalogHooks
  created_at: string
  updated_at: string
}

export async function listMcpCatalog(): Promise<McpCatalogEntry[]> {
  const { rows } = await pool.query('SELECT * FROM mcp_catalog ORDER BY "group", label')
  return rows as McpCatalogEntry[]
}

export async function getMcpCatalogEntry(id: string): Promise<McpCatalogEntry | null> {
  const { rows } = await pool.query('SELECT * FROM mcp_catalog WHERE id = $1', [id])
  return (rows[0] as McpCatalogEntry) ?? null
}

export async function upsertMcpCatalogEntry(
  id: string,
  entry: Omit<McpCatalogEntry, 'id' | 'created_at' | 'updated_at'>,
): Promise<void> {
  await pool.query(
    `INSERT INTO mcp_catalog (id, label, description, url, saas_url, "group", ui_panel, required, params, hooks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       url = EXCLUDED.url,
       saas_url = EXCLUDED.saas_url,
       "group" = EXCLUDED."group",
       ui_panel = EXCLUDED.ui_panel,
       required = EXCLUDED.required,
       params = EXCLUDED.params,
       hooks = EXCLUDED.hooks,
       updated_at = NOW()`,
    [
      id,
      entry.label,
      entry.description,
      entry.url,
      entry.saas_url,
      entry.group,
      entry.ui_panel,
      entry.required,
      JSON.stringify(entry.params),
      JSON.stringify(entry.hooks),
    ],
  )
}

export async function listMcpCatalogByHook(
  hookName: keyof McpCatalogHooks,
): Promise<McpCatalogEntry[]> {
  const { rows } = await pool.query(
    'SELECT * FROM mcp_catalog WHERE hooks->>$1 IS NOT NULL ORDER BY id',
    [hookName],
  )
  return rows as McpCatalogEntry[]
}

export async function deleteMcpCatalogEntry(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM mcp_catalog WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
