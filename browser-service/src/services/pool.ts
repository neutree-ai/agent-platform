// In-memory warm pool of pre-booted browser instances.
//
// Why in-memory: browser-service is single-replica, and a warm instance only
// matters until it is claimed. The pool (the unclaimed set) is fully
// reconcilable from sandbox-service on boot.
//
// The claim map (claimed → owner) is the hot path for ownership, but it is also
// mirrored to Postgres (browser.claims). Sandbox metadata is immutable (the
// OpenSandbox API exposes no metadata update), so a claimed instance keeps its
// `browser.pool=warm` tag forever and we cannot stamp an owner onto it. Without
// a durable record, a restart would lose every claim and reconcile could hand a
// claimed instance to a different user — so the pool used to reap ALL warm
// instances on startup, killing live sessions on every deploy. Now reconcile-
// Existing() restores claims from browser.claims and keeps those instances
// alive, reaping only warm instances with no claim record. Cross-user leak is
// still impossible (claimed instances are never re-handed-out; an instance with
// no claim row is reaped — fail closed), but owned sessions survive a restart.

import { pool as db } from '../lib/db'
import * as sandbox from './sandbox'

interface SandboxInfo {
  id: string
  status: { state: string }
  expiresAt: string
  createdAt: string
  metadata?: Record<string, string>
}

const POOL_SIZE = Number.parseInt(process.env.BROWSER_WARM_POOL_SIZE || '0', 10)
const RECONCILE_MS = Number.parseInt(process.env.BROWSER_POOL_RECONCILE_MS || '10000', 10)
// Warm instances are created with this TTL and renewed once they get within
// RENEW_THRESHOLD_MS of expiry, so an idle pool never reaps itself.
const WARM_TIMEOUT_SECONDS = Number.parseInt(process.env.BROWSER_POOL_WARM_TIMEOUT || '1800', 10)
const RENEW_THRESHOLD_MS = Number.parseInt(
  process.env.BROWSER_POOL_RENEW_THRESHOLD_MS || '600000',
  10,
)

interface PoolEntry {
  ready: boolean
  expiresAt: number // epoch ms
}

interface Claim {
  userId: string
  // Metadata the caller requested at claim time (e.g. browser.workspace_id).
  // Sandbox metadata is immutable, so a pooled instance can't carry these tags;
  // we virtually merge them on read paths (list filtering) instead.
  metadata: Record<string, string>
}

const pool = new Map<string, PoolEntry>() // unclaimed warm instances
const claims = new Map<string, Claim>() // sandboxId → claim (claimed pool instances)

export function isPoolEnabled(): boolean {
  return POOL_SIZE > 0
}

// Durable claim record (browser.claims). The in-memory `claims` map stays the
// hot path for ownership; these mirror it to Postgres so startup can keep
// already-claimed warm instances alive across a restart instead of reaping
// them. All writes are best-effort: if a persist fails the worst case is the
// old behaviour (instance reaped on next restart), so we never fail a claim or
// a delete on a DB error — fail closed, never fail open.
async function persistClaim(
  sandboxId: string,
  userId: string,
  metadata: Record<string, string>,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO browser.claims (sandbox_id, user_id, metadata)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (sandbox_id) DO UPDATE
         SET user_id = EXCLUDED.user_id, metadata = EXCLUDED.metadata`,
      [sandboxId, userId, JSON.stringify(metadata)],
    )
  } catch (e) {
    console.error('[pool] persistClaim failed for', sandboxId, e)
  }
}

function unpersistClaim(sandboxId: string): void {
  db.query('DELETE FROM browser.claims WHERE sandbox_id = $1', [sandboxId]).catch((e) =>
    console.error('[pool] unpersistClaim failed for', sandboxId, e),
  )
}

function parseExpiry(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Date.now() + WARM_TIMEOUT_SECONDS * 1000 : t
}

// Single source of truth for "does userId own this browser?". Claimed pool
// instances live in the claim map (their metadata has no browser.user_id);
// on-demand instances carry browser.user_id in their sandbox metadata.
export function isOwnedBy(
  sbx: { id: string; metadata?: Record<string, string> },
  userId: string,
): boolean {
  if (claims.get(sbx.id)?.userId === userId) return true
  return sbx.metadata?.['browser.user_id'] === userId
}

// Pooled instances currently claimed by userId, with the metadata recorded at
// claim time (for the list union — these don't appear in the metadata-filtered
// server-side list since their sandbox metadata has no browser.user_id).
export function ownedClaims(
  userId: string,
): Array<{ id: string; metadata: Record<string, string> }> {
  const out: Array<{ id: string; metadata: Record<string, string> }> = []
  for (const [id, claim] of claims) {
    if (claim.userId === userId) out.push({ id, metadata: claim.metadata })
  }
  return out
}

export function releaseClaim(sandboxId: string): void {
  claims.delete(sandboxId)
  unpersistClaim(sandboxId)
}

// Claim a ready warm instance for userId. The pick + reserve is synchronous (no
// await before claims.set) so concurrent requests can never grab the same id.
// Returns the renewed SandboxInfo, or null if nothing is ready (caller then
// falls back to an on-demand create).
export async function claim(
  userId: string,
  timeoutSeconds: number,
  metadata?: Record<string, string>,
): Promise<SandboxInfo | null> {
  let picked: string | undefined
  for (const [id, entry] of pool) {
    if (entry.ready) {
      picked = id
      break
    }
  }
  if (!picked) {
    const pending = [...pool.values()].filter((e) => !e.ready).length
    console.log(
      `[pool] claim miss for ${userId} — no ready instance (pending=${pending}), falling back to on-demand`,
    )
    return null
  }
  pool.delete(picked)
  claims.set(picked, { userId, metadata: metadata ?? {} })

  try {
    await sandbox.renewBrowser(picked, timeoutSeconds)
    const info = await sandbox.getBrowser(picked)
    // Persist before returning so the claim survives a restart. Best-effort:
    // a DB failure here only degrades to the pre-durability behaviour.
    await persistClaim(picked, userId, metadata ?? {})
    console.log(`[pool] claim hit ${picked} for ${userId}`)
    void reconcile() // refill in the background
    return info as SandboxInfo
  } catch (e) {
    // Instance died between pick and renew — drop the claim and let the caller
    // fall back to an on-demand create.
    claims.delete(picked)
    console.error('[pool] claim failed for', picked, e)
    return null
  }
}

let reconciling = false

async function reconcile(): Promise<void> {
  if (!isPoolEnabled() || reconciling) return
  reconciling = true
  try {
    const { items } = await sandbox.listPool()
    const live = new Set(items.map((s) => s.id))
    let changed = 0

    // Drop tracking for instances that no longer exist (expired / killed).
    for (const id of [...pool.keys()]) {
      if (!live.has(id)) {
        pool.delete(id)
        changed++
        console.log(`[pool] dropped warm ${id} (gone from sandbox-service)`)
      }
    }
    // A claimed instance keeps its browser.pool=warm tag, so it should always
    // appear in listPool. If it's missing, the warm-filtered list may just be
    // momentarily inconsistent — confirm the instance is provably gone (404)
    // before dropping the claim, or we'd orphan a live browser (404 on delete).
    for (const id of [...claims.keys()]) {
      if (live.has(id)) continue
      try {
        if ((await sandbox.getBrowserOrNull(id)) === null) {
          claims.delete(id)
          unpersistClaim(id)
          console.log(`[pool] released claim ${id} (instance gone)`)
        }
      } catch {
        // transient — keep the claim, re-check next round
      }
    }

    // Track live, unclaimed warm instances. Claimed ones stay out of the pool.
    for (const s of items) {
      if (claims.has(s.id)) continue
      const existing = pool.get(s.id)
      if (existing) existing.expiresAt = parseExpiry(s.expiresAt)
      else pool.set(s.id, { ready: false, expiresAt: parseExpiry(s.expiresAt) })
    }

    // Probe not-yet-ready instances (CDP up = browser actually driveable).
    await Promise.all(
      [...pool.entries()]
        .filter(([, e]) => !e.ready)
        .map(async ([id, e]) => {
          if (await sandbox.probeReady(id)) {
            e.ready = true
            changed++
            console.log(`[pool] warm ${id} ready`)
          }
        }),
    )

    // Renew instances nearing expiry so an idle pool never reaps itself.
    const now = Date.now()
    await Promise.all(
      [...pool.entries()]
        .filter(([, e]) => e.expiresAt - now < RENEW_THRESHOLD_MS)
        .map(async ([id, e]) => {
          try {
            const r = await sandbox.renewBrowser(id, WARM_TIMEOUT_SECONDS)
            e.expiresAt = parseExpiry(r.expiresAt)
            changed++
            console.log(`[pool] renewed warm ${id}`)
          } catch {
            // leave it; next reconcile re-evaluates
          }
        }),
    )

    // Create the deficit. pool.size counts ready + pending, so we never
    // over-provision while instances are still warming up.
    const deficit = POOL_SIZE - pool.size
    if (deficit > 0) {
      console.log(`[pool] deficit ${deficit}, creating warm instance(s)`)
      await Promise.all(
        Array.from({ length: deficit }, async () => {
          try {
            const info = await sandbox.createWarmBrowser({ timeoutSeconds: WARM_TIMEOUT_SECONDS })
            pool.set(info.id, { ready: false, expiresAt: parseExpiry(info.expiresAt) })
            changed++
            console.log(`[pool] created warm ${info.id}`)
          } catch (e) {
            console.error('[pool] create warm failed', e)
          }
        }),
      )
    }

    // Summary only when something changed this round (avoids 10s no-op spam).
    if (changed > 0) {
      const ready = [...pool.values()].filter((e) => e.ready).length
      console.log(
        `[pool] state: ready=${ready} pending=${pool.size - ready} claimed=${claims.size} target=${POOL_SIZE}`,
      )
    }
  } catch (e) {
    console.error('[pool] reconcile error', e)
  } finally {
    reconciling = false
  }
}

// Reconcile pre-existing warm instances against the durable claim table on
// startup. Restores in-memory claims for instances a user still owns (kept
// alive across the restart), and reaps only the genuinely unclaimed ones.
//
// Why reaping unclaimed warm is still correct: a warm instance with no claim row
// was either never handed out, or its claim persist failed — in the latter case
// we cannot tell who owns it, so we fail closed and reap it (the same guarantee
// the old unconditional reap gave, now scoped to instances we have no record
// for). A claimed instance never gets re-handed-out because reconcile() skips
// anything in the `claims` map.
async function reconcileExisting(): Promise<void> {
  try {
    const { rows } = await db.query<{
      sandbox_id: string
      user_id: string
      metadata: Record<string, string>
    }>('SELECT sandbox_id, user_id, metadata FROM browser.claims')
    const claimBy: Map<string, { userId: string; metadata: Record<string, string> }> = new Map(
      rows.map((r) => [r.sandbox_id, { userId: r.user_id, metadata: r.metadata ?? {} }]),
    )

    const { items } = await sandbox.listPool()
    const live = new Set(items.map((s) => s.id))

    // Restore claims for instances that survived the restart; prune rows whose
    // instance is already gone (expired / killed while we were down).
    for (const [id, claim] of claimBy) {
      if (live.has(id)) claims.set(id, claim)
      else unpersistClaim(id)
    }

    // Reap warm instances we have no claim record for (orphans / failed persist).
    const orphans = items.filter((s) => !claims.has(s.id))
    if (orphans.length) {
      console.log(`[pool] reaping ${orphans.length} unclaimed warm instance(s) on startup`)
    }
    await Promise.all(orphans.map((s) => sandbox.deleteBrowser(s.id).catch(() => {})))

    if (claims.size) {
      console.log(`[pool] restored ${claims.size} claimed warm instance(s) across restart`)
    }
  } catch (e) {
    console.error('[pool] reconcile on startup failed', e)
  }
}

export async function startPool(): Promise<void> {
  if (!isPoolEnabled()) {
    console.log('[pool] warm pool disabled (BROWSER_WARM_POOL_SIZE=0)')
    return
  }
  console.log(`[pool] starting warm pool, target=${POOL_SIZE}`)
  await reconcileExisting()
  await reconcile()
  setInterval(() => void reconcile(), RECONCILE_MS)
}
