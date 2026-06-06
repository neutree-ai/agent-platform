/**
 * LRU eviction sweep.
 *
 * We watch total cache size and prune the least-recently-touched version
 * dirs when it crosses the high-water mark. Touch time is tracked via the
 * `.access` marker file in each version dir (written on hit by `cache.ts`).
 * NFS atime is too unreliable to use directly.
 *
 * Safety rails:
 *   - Skip dirs that are in-flight (mid-unpack).
 *   - Skip dirs touched within `MIN_AGE_SEC` so in-flight reads can finish.
 *   - Also reap orphan `.tmp-*` dirs older than `TMP_MAX_AGE_SEC`
 *     (crashed-mid-extract debris).
 *
 * The sweep runs every `SWEEP_INTERVAL_SEC` regardless of pressure so old
 * version dirs (left behind when a skill is re-uploaded) drain even when
 * we're well under the high-water mark — capped at `KEEP_PER_SKILL` versions
 * per skill so a chatty re-upload pattern can't fill the disk on its own.
 *
 * Single-replica scope. Multi-replica fan-out would need leader-elected GC
 * with a coordination layer; deferred.
 */
import type { Dirent } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isInflight } from './cache'
import { pool } from './db'

const CACHE_DIR = process.env.CACHE_DIR || '/var/cache/skills-content'

// Triggered eviction kicks in above this many bytes total.
const HIGH_WATER_BYTES = Number(process.env.CACHE_HIGH_WATER_BYTES || 8 * 1024 ** 3) // 8 GiB
// Evict down to this once triggered. The gap dampens thrashing.
const LOW_WATER_BYTES = Number(process.env.CACHE_LOW_WATER_BYTES || 6 * 1024 ** 3) // 6 GiB
// Per-skill cap on retained version dirs (oldest evicted first).
const KEEP_PER_SKILL = Number(process.env.CACHE_KEEP_PER_SKILL || 3)
// Don't touch dirs younger than this — gives any in-flight proxy a window
// to finish reading without seeing ENOENT.
const MIN_AGE_SEC = Number(process.env.CACHE_MIN_AGE_SEC || 60)
// Crashed-mid-extract debris cleanup threshold.
const TMP_MAX_AGE_SEC = Number(process.env.CACHE_TMP_MAX_AGE_SEC || 3600)
// How often the sweep runs.
const SWEEP_INTERVAL_SEC = Number(process.env.CACHE_SWEEP_INTERVAL_SEC || 300)

interface VersionEntry {
  // Skill UUID (cache subdir name). Pre-p3 this was the skill's textual name;
  // post-p3 the cache is keyed on `skills.id`.
  name: string
  versionKey: string
  dir: string
  // Directory mtime, used as "newest first" ordering for the per-skill cap.
  // `content_hash`-keyed dirs aren't sortable by name; mtime is the closest
  // proxy for recency we have.
  createdMs: number
  accessMs: number
  sizeBytes: number
}

export function startLruSweep() {
  const run = () => {
    sweep().catch((err) => {
      console.error('[skills-content] lru sweep failed:', (err as Error).message)
    })
  }
  // Kick the first sweep on boot so we surface config / fs issues early
  // rather than waiting a full interval.
  setTimeout(run, 30_000)
  setInterval(run, SWEEP_INTERVAL_SEC * 1000)
}

async function sweep(): Promise<void> {
  const entries = await scan()
  const now = Date.now()

  // 1. Reap stale tmp dirs first — they shouldn't count toward the budget.
  await reapTmpDirs(now)

  // 2. Reap orphan skills — entire `<CACHE>/<name>/` subtrees whose row no
  //    longer exists in `skills`. Per-skill cap and high-water alone never
  //    free these because they only key off mtime / access; without a DB
  //    cross-check a deleted skill leaks disk forever.
  await reapOrphanSkills(entries)

  // 3. Per-skill version cap. Sort each skill's versions oldest-first and
  //    drop everything past KEEP_PER_SKILL.
  const bySkill = new Map<string, VersionEntry[]>()
  for (const e of entries) {
    const arr = bySkill.get(e.name) ?? []
    arr.push(e)
    bySkill.set(e.name, arr)
  }
  for (const arr of bySkill.values()) {
    if (arr.length <= KEEP_PER_SKILL) continue
    // Newest first; everything past KEEP_PER_SKILL is overflow.
    arr.sort((a, b) => b.createdMs - a.createdMs)
    for (let i = KEEP_PER_SKILL; i < arr.length; i++) {
      await maybeEvict(arr[i], now)
    }
  }

  // 4. Global high-water check. Recompute total after the cap pass so we
  //    don't over-evict.
  const surviving = (await scan()).filter((e) => now - e.accessMs >= MIN_AGE_SEC * 1000)
  let total = surviving.reduce((sum, e) => sum + e.sizeBytes, 0)
  if (total <= HIGH_WATER_BYTES) return

  surviving.sort((a, b) => a.accessMs - b.accessMs) // oldest first
  for (const e of surviving) {
    if (total <= LOW_WATER_BYTES) break
    if (await maybeEvict(e, now)) total -= e.sizeBytes
  }
}

async function maybeEvict(e: VersionEntry, now: number): Promise<boolean> {
  if (isInflight(e.name, e.versionKey)) return false
  if (now - e.accessMs < MIN_AGE_SEC * 1000) return false
  try {
    await rm(e.dir, { recursive: true, force: true })
    return true
  } catch (err) {
    console.warn(`[skills-content] lru evict failed for ${e.dir}: ${(err as Error).message}`)
    return false
  }
}

async function scan(): Promise<VersionEntry[]> {
  const out: VersionEntry[] = []
  let skills: string[]
  try {
    skills = await readdir(CACHE_DIR)
  } catch {
    return out
  }
  for (const name of skills) {
    if (name.startsWith('.')) continue
    const skillDir = join(CACHE_DIR, name)
    let versions: string[]
    try {
      versions = await readdir(skillDir)
    } catch {
      continue
    }
    for (const v of versions) {
      // Skip in-flight tmp dirs (`.tmp-<hex>`) and any other dotfiles —
      // those are handled by `reapTmpDirs`.
      if (v.startsWith('.')) continue
      const dir = join(skillDir, v)
      let createdMs = 0
      try {
        const s = await stat(dir)
        if (!s.isDirectory()) continue
        createdMs = s.mtimeMs
      } catch {
        continue
      }
      const access = await readAccess(dir)
      const sizeBytes = await dirSize(dir)
      out.push({ name, versionKey: v, dir, createdMs, accessMs: access, sizeBytes })
    }
  }
  return out
}

async function readAccess(dir: string): Promise<number> {
  try {
    const s = await stat(join(dir, '.access'))
    return s.mtimeMs
  } catch {
    // No marker → use the dir's own mtime as a fallback.
    try {
      const s = await stat(dir)
      return s.mtimeMs
    } catch {
      return 0
    }
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      total += await dirSize(p)
    } else if (e.isFile()) {
      try {
        const s = await stat(p)
        total += s.size
      } catch {
        // ignore — file may have been removed concurrently
      }
    }
  }
  return total
}

async function reapOrphanSkills(entries: VersionEntry[]): Promise<void> {
  // Build the candidate set from what we saw on disk so we don't mistakenly
  // delete a freshly-unpacked dir we missed in this scan. Order matters: we
  // query DB *after* readdir so a skill deleted between the two reads is
  // (correctly) caught as orphan; a skill created in the same window simply
  // wasn't on disk yet and won't be touched.
  const onDisk = new Set<string>()
  for (const e of entries) onDisk.add(e.name)
  if (onDisk.size === 0) return

  let live: Set<string>
  try {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM skills')
    live = new Set(rows.map((r) => r.id))
  } catch (err) {
    console.warn(
      `[skills-content] lru orphan sweep skipped (db query failed): ${(err as Error).message}`,
    )
    return
  }

  for (const name of onDisk) {
    if (live.has(name)) continue
    const skillDir = join(CACHE_DIR, name)
    try {
      await rm(skillDir, { recursive: true, force: true })
      console.log(`[skills-content] lru: reaped orphan skill dir name=${name}`)
    } catch (err) {
      console.warn(
        `[skills-content] lru orphan reap failed for ${skillDir}: ${(err as Error).message}`,
      )
    }
  }
}

async function reapTmpDirs(now: number): Promise<void> {
  let skills: string[]
  try {
    skills = await readdir(CACHE_DIR)
  } catch {
    return
  }
  for (const name of skills) {
    if (name.startsWith('.')) continue
    const skillDir = join(CACHE_DIR, name)
    let children: string[]
    try {
      children = await readdir(skillDir)
    } catch {
      continue
    }
    for (const c of children) {
      if (!c.startsWith('.tmp-')) continue
      const dir = join(skillDir, c)
      try {
        const s = await stat(dir)
        if (now - s.mtimeMs < TMP_MAX_AGE_SEC * 1000) continue
        await rm(dir, { recursive: true, force: true })
      } catch {
        // ignore — concurrent worker may have already cleaned up
      }
    }
  }
}
