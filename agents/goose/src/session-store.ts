/**
 * Per-session goose data dirs + the SessionIdCodec that binds them.
 *
 * Goose keeps every session in one shared SQLite catalog (WAL mode,
 * $DATA_DIR/goose/sessions/sessions.db). On the workspace volume that file
 * sits on NFS, where a single writer already suffers sqlx's 5s busy-timeout
 * convoy (10-56s turns measured) and concurrent writers from multiple NFS
 * clients are documented-unsafe — and the serverless direction (one workspace
 * scaling to N pods sharing one PV) makes multiple clients unavoidable.
 *
 * So each platform session gets its own GOOSE_PATH_ROOT with a private tiny
 * sessions.db holding exactly one session: single-writer by construction (cp
 * serializes turns per session), collision-free across pods, and deleting or
 * archiving a session is a plain directory operation.
 *
 * Dir layout — $HOME/.goose-sessions/<platform-uuid>/:
 *   config  -> ~/.config/goose   symlink: shared config.yaml / AGENTS.md,
 *                                so cp config pushes stay hot for every session
 *   .agents -> ~/.agents         symlink: shared skills
 *   data/                        goose-created; sessions.db lives here
 *   state/                       per-session goose logs
 *   meta.json                    ours: { "native_id": "YYYYMMDD_1" }
 *
 * The platform uuid is minted BEFORE the ACP session exists (acp-server's
 * draft id) so the dir can be staged for the spawn. Goose's native id — in a
 * fresh db always `<date>_1` — is recorded in meta.json by the codec's
 * encode() when createSession returns.
 *
 * GOOSE_PATH_ROOT redirects *all* goose dirs ($ROOT/{config,data,state},
 * $ROOT/.agents — crates/goose/src/config/paths.rs). Only data and state
 * should be per-session; config and .agents point back to the shared copies
 * via the symlinks above.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { SessionIdCodec } from '../../../internal/acp-adapter/acp-bridge.js'

const HOME = process.env.HOME ?? `${process.env.WORKSPACE_DIR || '/workspace'}/.home`

export const SESSIONS_BASE = join(HOME, '.goose-sessions')

// Platform ids become path components. Normal ids are randomUUID() output;
// anything else (no leading alnum kills `..`, no `/` in the class) is
// rejected rather than resolved outside SESSIONS_BASE.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function sessionDataDir(platformId: string): string {
  if (!SAFE_ID.test(platformId)) {
    throw new Error(`Refusing unsafe session id as path component: ${platformId}`)
  }
  return join(SESSIONS_BASE, platformId)
}

/**
 * Stage the session's GOOSE_PATH_ROOT before spawning its bridge. Idempotent —
 * resumed sessions pass through here too and just get the existing dir back.
 */
export function prepareSessionDir(platformId: string): string {
  const dir = sessionDataDir(platformId)
  mkdirSync(dir, { recursive: true })
  ensureSharedLink(join(HOME, '.config', 'goose'), join(dir, 'config'))
  ensureSharedLink(join(HOME, '.agents'), join(dir, '.agents'))
  return dir
}

function ensureSharedLink(target: string, link: string): void {
  mkdirSync(target, { recursive: true })
  try {
    symlinkSync(target, link)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
}

function metaPath(platformId: string): string {
  return join(sessionDataDir(platformId), 'meta.json')
}

export function readNativeId(platformId: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(metaPath(platformId), 'utf-8'))
    return typeof meta?.native_id === 'string' ? meta.native_id : null
  } catch {
    return null
  }
}

function writeNativeId(platformId: string, nativeId: string): void {
  const path = metaPath(platformId)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ native_id: nativeId }))
  renameSync(tmp, path)
}

/**
 * Codec for one session's bridge (1 bridge : 1 session : 1 data dir).
 */
export function sessionDirCodec(platformId: string): SessionIdCodec {
  return {
    // Called once, when createSession returns goose's freshly-minted native
    // id — in this session's private db always `<date>_1`. Record it and
    // adopt the pre-staged platform id.
    encode(nativeId: string): string {
      writeNativeId(platformId, nativeId)
      return platformId
    },
    // loadSession/prompt/cancel pass platform ids; goose only knows the
    // native one. Missing meta (a cross-core id, or a dir that never
    // completed createSession) falls through unchanged so goose's
    // session/load fails with its own not-found error, which the /chat
    // handler wraps with the actionable cross-core hint.
    decode(pid: string): string {
      return readNativeId(pid) ?? pid
    },
  }
}

/**
 * Boot-time GC for the crash window between prepareSessionDir and
 * createSession: a dir with no meta.json that has stopped changing is an
 * orphan (live dirs gain meta.json within seconds of creation). Errors are
 * per-entry and non-fatal — a missed orphan waits for the next boot.
 */
export function sweepOrphanSessionDirs(maxAgeMs = 24 * 60 * 60 * 1000): void {
  let entries: string[]
  try {
    entries = readdirSync(SESSIONS_BASE)
  } catch {
    return
  }
  for (const name of entries) {
    const dir = join(SESSIONS_BASE, name)
    try {
      if (existsSync(join(dir, 'meta.json'))) continue
      if (Date.now() - statSync(dir).mtimeMs < maxAgeMs) continue
      rmSync(dir, { recursive: true, force: true })
      console.log(`[agent] Swept orphan session dir: ${name}`)
    } catch {
      // Leave it for the next boot.
    }
  }
}
