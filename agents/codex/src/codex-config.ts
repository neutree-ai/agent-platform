/**
 * Assembling what codex reads at startup: the provider's model profile on disk,
 * and the pieces of `config.toml` that have to be reconciled with whatever the
 * user put in agent_settings.
 *
 * Everything here is best-effort by design. codex treats an unreadable
 * `model_catalog_json` as fatal — it exits instead of starting — so a profile
 * that cp accepted but this codex build rejects would take the workspace down
 * with it. cp validates the shape it acts on; this module is the second gate,
 * and it fails by writing no catalog at all: the session goes back to codex's
 * fallback metadata and its warning, which is where every workspace was before
 * the profile existed.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** What the caller writes into `config.toml`; absent keys are simply not written. */
export interface CodexProfileConfig {
  /** Absolute path of the catalog file, once it is on disk and re-readable. */
  catalogPath?: string
  /** Only set when the catalog says this model supports the level. */
  reasoningEffort?: string
  /** Overrides the wire protocol inferred from the provider type. */
  wireApi?: 'responses' | 'chat'
}

interface CatalogModel {
  slug?: unknown
  supported_reasoning_levels?: unknown
}

/** Levels the catalog declares for one model, empty when it declares none. */
function declaredLevels(model: CatalogModel): string[] {
  const levels = model.supported_reasoning_levels
  if (!Array.isArray(levels)) return []
  return levels
    .map((l) => (l as { effort?: unknown })?.effort)
    .filter((e): e is string => typeof e === 'string')
}

export function applyModelProfile(
  codexDir: string,
  profile: unknown,
  model: string,
): CodexProfileConfig {
  // Drop any catalog from a previous config first: config.toml only points at
  // the file when this run wrote one, and a leftover on disk reads as current.
  const catalogPath = join(codexDir, 'models.json')
  rmSync(catalogPath, { force: true })

  const codex = (profile as { codex?: Record<string, unknown> } | null | undefined)?.codex
  if (!codex || typeof codex !== 'object') return {}

  const result: CodexProfileConfig = {}

  const wireApi = codex.wire_api
  if (wireApi === 'responses' || wireApi === 'chat') {
    result.wireApi = wireApi
  }

  const catalog = codex.model_catalog as { models?: CatalogModel[] } | undefined
  if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
    if (catalog) console.error('[agent] Model catalog ignored: no models array')
    return result
  }

  try {
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
    // Read it back rather than trusting the write: a truncated file is the one
    // failure mode that would reach codex as a fatal parse error.
    JSON.parse(readFileSync(catalogPath, 'utf-8'))
    result.catalogPath = catalogPath
  } catch (e) {
    console.error(`[agent] Model catalog not applied: ${(e as Error).message}`)
    return result
  }

  const entry = catalog.models.find((m) => m.slug === model)
  if (!entry) {
    // Not an error: a provider's catalog covers the models it serves, and the
    // workspace may be pointed at another one. codex falls back to its own
    // metadata for this model, exactly as it does with no catalog at all.
    console.log(
      `[agent] Model catalog has no entry for "${model}" (covers: ${catalog.models
        .map((m) => String(m.slug))
        .join(', ')})`,
    )
    return result
  }

  const effort = codex.reasoning_effort
  if (typeof effort === 'string') {
    const levels = declaredLevels(entry)
    if (levels.length === 0 || levels.includes(effort)) {
      result.reasoningEffort = effort
    } else {
      console.error(
        `[agent] reasoning_effort "${effort}" dropped: ${model} declares ${levels.join(', ')}`,
      )
    }
  }

  return result
}

/**
 * Top-level TOML keys the user set in agent_settings.
 *
 * Only the region before the first table header counts: a key inside
 * `[mcp_servers.x]` belongs to that table, and treating it as an override would
 * silently drop a platform default the user never touched. Duplicating a
 * top-level key is a TOML parse error, so this is what decides whether the
 * platform writes its own copy.
 */
export function userTopLevelKeys(agentSettings: string): Set<string> {
  const keys = new Set<string>()
  for (const line of agentSettings.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) break
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*=/.exec(trimmed)
    if (match) keys.add(match[1])
  }
  return keys
}

/**
 * Table headers the user declared in agent_settings.
 *
 * TOML rejects a table defined twice, and codex treats that as a fatal config
 * error — so a platform table the user already wrote has to be dropped rather
 * than emitted alongside theirs.
 */
export function userTables(agentSettings: string): Set<string> {
  const tables = new Set<string>()
  for (const line of agentSettings.split('\n')) {
    const match = /^\s*\[\[?([^\]]+)\]\]?/.exec(line)
    if (match) tables.add(match[1].trim())
  }
  return tables
}
