import { DEFAULT_WORKSPACE_RESOURCES, defaultCfg } from '../../../../internal/k8s-provider'
import type { ComputeResources } from '../../../../internal/types/api'
import { parseCpuMillis, parseMemMi } from '../../lib/k8s-quantity'
import { pool } from './pool'

/**
 * The resource side of a user's footprint, read off the runtime meter's state
 * log (`workspace_runtime_events`, migration 134). Where the token ledger
 * answers "what did I consume", this answers "what am I holding" — compute
 * that ran and disks that are still allocated.
 */

/**
 * A logged row stays in force until the next row for that workspace, so an
 * interval is `[ts, next ts)` and the newest row runs to now(). Everything
 * below is that one idea plus a clip to the requested window.
 */
function intervals(where: string): string {
  return `
  SELECT workspace_id, resources, phase, ready_replicas, spec_version, ts AS started,
         COALESCE(LEAD(ts) OVER (PARTITION BY workspace_id ORDER BY ts, id), now()) AS ended
    FROM workspace_runtime_events
   WHERE ${where}`
}

const INTERVALS = intervals('user_id = $1')

/**
 * Replicas to charge an interval for. `starting` counts as one: the pod is
 * scheduled and holding its request well before it reports ready. `running`
 * with no ready replica yet is the same situation seen from the other side, so
 * it floors at one rather than dropping to zero.
 */
const REPLICAS = `CASE WHEN phase IN ('running', 'starting')
                       THEN GREATEST(COALESCE(ready_replicas, 1), 1) ELSE 0 END`

/** Inclusive window matching the token summary's convention: today + N-1 prior days. */
const SINCE = `(current_date - ($2::int * interval '1 day'))::date`

/**
 * When a workspace was last touched, matching `listIdleRunningWorkspaces` so
 * the view and the idle GC never disagree about what counts as activity.
 */
const LAST_USED = `GREATEST(
       w.created_at,
       COALESCE((SELECT MAX(s.last_active_at) FROM sessions s WHERE s.workspace_id = w.id),
                'epoch'::timestamptz),
       COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.workspace_id = w.id),
                'epoch'::timestamptz)
     )`

/** Millicore-seconds → core-hours. */
function toCoreHours(milliSeconds: number): number {
  return milliSeconds / 1000 / 3600
}

/** A workspace's requested CPU, resolved through the same defaults the pod gets. */
function cpuMillisOf(resources: ComputeResources): number {
  return parseCpuMillis(resources.cpu_request || DEFAULT_WORKSPACE_RESOURCES.cpu_request)
}

/** A workspace's disk in GiB, resolved through the cluster's default volume size. */
function storageGibOf(resources: ComputeResources): number {
  return parseMemMi(resources.storage || defaultCfg.workspaceStorageSize) / 1024
}

interface SecondsByResources {
  resources: ComputeResources
  replica_seconds: string
}

interface DailyRow extends SecondsByResources {
  date: Date | string
}

interface WorkspaceRow extends SecondsByResources {
  workspace_id: string
  name: string
  idle_seconds: string
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/** Bucket rows by a key, preserving the order the keys first appear in. */
function group<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = out.get(keyOf(row))
    if (bucket) bucket.push(row)
    else out.set(keyOf(row), [row])
  }
  return out
}

/** Fold rows carrying their own spec into one core-hour figure. */
function coreHours(rows: SecondsByResources[]): number {
  return toCoreHours(
    rows.reduce((sum, r) => sum + Number(r.replica_seconds) * cpuMillisOf(r.resources), 0),
  )
}

interface ComputeUsage {
  daily: { date: string; coreHours: number }[]
  byWorkspace: { workspaceId: string; name: string; coreHours: number }[]
  totalCoreHours: number
  /**
   * Per workspace, the core-hours it kept running after its last activity —
   * read off the same intervals as the total, so the two are always parts of
   * one whole rather than one measurement and one extrapolation.
   */
  idleCoreHoursByWorkspace: Record<string, number>
}

/**
 * Daily and per-workspace compute over the window. Both queries clip intervals
 * to their bucket, so a workspace that ran across midnight lands its seconds on
 * both days rather than on whichever one it started in.
 */
export async function getUserComputeUsage(userId: string, days: number): Promise<ComputeUsage> {
  const offset = Math.max(0, days - 1)
  const [dailyRes, wsRes] = await Promise.all([
    pool.query(
      `WITH iv AS (${INTERVALS}), spine AS (
         SELECT generate_series(${SINCE}, current_date, '1 day')::date AS day
       )
       SELECT spine.day::date AS date, iv.resources,
              SUM(EXTRACT(EPOCH FROM (LEAST(iv.ended, spine.day + 1)
                                    - GREATEST(iv.started, spine.day)))
                  * ${REPLICAS})::bigint AS replica_seconds
         FROM spine
         JOIN iv ON iv.started < spine.day + 1 AND iv.ended > spine.day AND ${REPLICAS} > 0
        GROUP BY 1, 2
        ORDER BY 1 ASC`,
      [userId, offset],
    ),
    pool.query(
      `WITH iv AS (${INTERVALS})
       SELECT iv.workspace_id, COALESCE(w.name, iv.workspace_id) AS name, iv.resources,
              SUM(EXTRACT(EPOCH FROM (LEAST(iv.ended, now())
                                    - GREATEST(iv.started, ${SINCE})))
                  * ${REPLICAS})::bigint AS replica_seconds,
              -- A workspace with no row left in workspaces has been deleted, so
              -- none of its time is reclaimable and none of it counts as idle.
              SUM(GREATEST(0, EXTRACT(EPOCH FROM (LEAST(iv.ended, now())
                                    - GREATEST(iv.started, ${SINCE},
                                               COALESCE(${LAST_USED}, now())))))
                  * ${REPLICAS})::bigint AS idle_seconds
         FROM iv
         LEFT JOIN workspaces w ON w.id = iv.workspace_id
        WHERE iv.ended > ${SINCE} AND ${REPLICAS} > 0
        GROUP BY 1, 2, 3`,
      [userId, offset],
    ),
  ])

  // Both queries yield one row per (bucket, spec) — fold the specs away here,
  // where the quantity parser lives, rather than duplicating it in SQL.
  const daily = [...group(dailyRes.rows as DailyRow[], (r) => isoDate(r.date))].map(
    ([date, rows]) => ({ date, coreHours: coreHours(rows) }),
  )

  const perWorkspace = [...group(wsRes.rows as WorkspaceRow[], (r) => r.workspace_id)].map(
    ([workspaceId, rows]) => ({
      workspaceId,
      name: rows[0].name,
      coreHours: coreHours(rows),
      idleCoreHours: coreHours(rows.map((r) => ({ ...r, replica_seconds: r.idle_seconds }))),
    }),
  )

  const byWorkspace = perWorkspace
    .filter((w) => w.coreHours > 0)
    .map(({ workspaceId, name, coreHours }) => ({ workspaceId, name, coreHours }))
    .sort((a, b) => b.coreHours - a.coreHours)

  return {
    daily,
    byWorkspace,
    totalCoreHours: byWorkspace.reduce((sum, w) => sum + w.coreHours, 0),
    idleCoreHoursByWorkspace: Object.fromEntries(
      perWorkspace.map((w) => [w.workspaceId, w.idleCoreHours]),
    ),
  }
}

export interface WorkspaceFootprint {
  workspaceId: string
  name: string
  status: string
  /** True for auto-scaling workspaces, whose idleness the autoscaler owns. */
  autoScaling: boolean
  coreRequest: number
  storageGib: number
  lastUsed: string
  idleDays: number
}

/**
 * Every live workspace the user owns, with its spec and how long it has sat
 * without activity. One query backs both "running but idle" and "stopped but
 * still holding a disk" — they are the same inventory read two ways.
 *
 * `last_used` matches `listIdleRunningWorkspaces` so the view and the idle GC
 * agree on what counts as activity.
 */
export async function listUserWorkspaceFootprints(userId: string): Promise<WorkspaceFootprint[]> {
  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.status, p.runtime_mode,
            COALESCE(wc.compute_resources, '{}'::jsonb) AS resources,
            GREATEST(
              w.created_at,
              COALESCE((SELECT MAX(s.last_active_at) FROM sessions s WHERE s.workspace_id = w.id),
                       'epoch'::timestamptz),
              COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.workspace_id = w.id),
                       'epoch'::timestamptz)
            ) AS last_used
       FROM workspaces w
       JOIN workspace_placements p ON p.workspace_id = w.id
       LEFT JOIN workspace_config wc ON wc.workspace_id = w.id
      WHERE w.user_id = $1 AND w.is_system = false AND p.desired_phase <> 'deleted'`,
    [userId],
  )
  const now = Date.now()
  return rows.map((r: Record<string, unknown>) => {
    const lastUsed = r.last_used as Date
    return {
      workspaceId: r.id as string,
      name: r.name as string,
      status: r.status as string,
      autoScaling: r.runtime_mode === 'auto-scaling',
      coreRequest: cpuMillisOf(r.resources as ComputeResources) / 1000,
      storageGib: storageGibOf(r.resources as ComputeResources),
      lastUsed: lastUsed.toISOString(),
      idleDays: (now - lastUsed.getTime()) / 86_400_000,
    }
  })
}

export interface RuntimeSegment {
  startedAt: string
  endedAt: string
  phase: string
  /** Replicas held over the segment; 0 while the workspace was not up. */
  replicas: number
  coreRequest: number
  storageGib: number
  specVersion: number | null
}

/**
 * One workspace's state log as a timeline. Unlike the summaries this does not
 * aggregate: infra time belongs to a stretch of wall clock rather than to any
 * session, so the shape of the stretch is the thing worth looking at.
 */
export async function getWorkspaceTimeline(
  workspaceId: string,
  days: number,
): Promise<RuntimeSegment[]> {
  const offset = Math.max(0, days - 1)
  const { rows } = await pool.query(
    `WITH iv AS (${intervals('workspace_id = $1')})
     SELECT GREATEST(started, ${SINCE}) AS started, LEAST(ended, now()) AS ended,
            phase, ${REPLICAS} AS replicas, resources, spec_version
       FROM iv
      WHERE ended > ${SINCE}
      ORDER BY started ASC`,
    [workspaceId, offset],
  )
  const segments = rows.map((r: Record<string, unknown>) => ({
    startedAt: (r.started as Date).toISOString(),
    endedAt: (r.ended as Date).toISOString(),
    phase: r.phase as string,
    replicas: Number(r.replicas),
    coreRequest: cpuMillisOf(r.resources as ComputeResources) / 1000,
    storageGib: storageGibOf(r.resources as ComputeResources),
    specVersion: r.spec_version === null ? null : Number(r.spec_version),
  }))

  // The log records every observation change, several of which leave the
  // workspace in the same state as far as a timeline is concerned (a replica
  // count first becoming known, say). Adjacent rows that describe the same
  // state are one stretch of time, and drawing them apart implies a change
  // that never happened.
  return mergeSegments(segments)
}

/**
 * Collapse adjacent segments that describe the same state.
 */
export function mergeSegments(segments: RuntimeSegment[]): RuntimeSegment[] {
  return segments.reduce<RuntimeSegment[]>((merged, segment) => {
    const previous = merged[merged.length - 1]
    if (previous && sameState(previous, segment)) {
      previous.endedAt = segment.endedAt
      return merged
    }
    merged.push({ ...segment })
    return merged
  }, [])
}

function sameState(a: RuntimeSegment, b: RuntimeSegment): boolean {
  return (
    a.phase === b.phase &&
    a.replicas === b.replicas &&
    a.coreRequest === b.coreRequest &&
    a.storageGib === b.storageGib &&
    a.specVersion === b.specVersion
  )
}
