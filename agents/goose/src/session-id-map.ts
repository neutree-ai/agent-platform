/**
 * Stateful SessionIdCodec: platform-facing UUIDs aliased to goose's native
 * session ids.
 *
 * Goose generates session ids as `YYYYMMDD_<counter>` inside its SQLite store
 * and offers no way to supply a client id — the counter is per-instance AND
 * resets if the store is wiped (/local/reset, PVC restore, session deletion),
 * so any scheme derived from the native id (even workspace-prefixed) can
 * recycle an id that cp already persisted. Minting a fresh UUID per
 * createSession and keeping a durable alias map is the only collision-free
 * option.
 *
 * Map file: $HOME/.acp-session-map.json — { "<uuid>": "<nativeId>" }.
 * Written atomically (tmp + rename). Grows by ~50 bytes per session; no
 * pruning needed at realistic volumes.
 *
 * decode() tolerates the two legacy id forms that predate this mapper:
 *  - `<workspaceId>-YYYYMMDD_<n>` (prefix codec era) → strip the prefix
 *  - `YYYYMMDD_<n>` (raw passthrough era) → unchanged
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionIdCodec } from '../../../internal/acp-adapter/acp-bridge.js'

/** Shared instance — index.ts wires it into BRIDGE_OPTS; server.ts uses it to
 * translate platform ids back to native ones for usage tracking. */
let _instance: SessionIdCodec | null = null
export function sessionIdMap(): SessionIdCodec {
  if (!_instance) {
    _instance = createSessionIdMap(
      process.env.HOME ?? `${process.env.WORKSPACE_DIR || '/workspace'}/.home`,
      process.env.WORKSPACE_ID,
    )
  }
  return _instance
}

export function createSessionIdMap(homeDir: string, workspaceId?: string): SessionIdCodec {
  const file = join(homeDir, '.acp-session-map.json')
  const legacyPrefix = workspaceId ? `${workspaceId}-` : ''

  let map: Record<string, string> = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object') map = parsed
  } catch {
    // Missing or corrupt — start fresh; legacy ids still decode via fallbacks.
  }

  function persist(): void {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(map))
    renameSync(tmp, file)
  }

  return {
    // Called once per createSession with the freshly-minted native id. Always
    // mint a new UUID — never reuse an alias even if the native id was seen
    // before (a wiped goose store recycles native ids; reusing the alias
    // would merge the new session into a dead cp session).
    encode(nativeId: string): string {
      const uuid = randomUUID()
      map[uuid] = nativeId
      try {
        persist()
      } catch (e) {
        console.error(`[agent] session-id map persist failed: ${(e as Error).message}`)
      }
      return uuid
    },

    decode(platformId: string): string {
      const mapped = map[platformId]
      if (mapped) return mapped
      if (legacyPrefix && platformId.startsWith(legacyPrefix)) {
        return platformId.slice(legacyPrefix.length)
      }
      return platformId
    },
  }
}
