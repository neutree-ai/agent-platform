import type { ComputeResources } from '../../../../internal/types/api'
import type { ObservedPhase } from '../../../../internal/types/environments'
import type { RuntimeMode } from '../../../../internal/types/runtime-mode'
import { ENV_OFFLINE_SQL } from './environments'
import { pool } from './pool'

/**
 * Storage for the runtime meter: an append-only state log of what every
 * workspace was observed to be (`workspace_runtime_events`), plus the windows
 * during which the meter was running (`runtime_meter_windows`). See migration
 * 134 for what the columns mean and why the log has no foreign keys.
 */

/**
 * The phases a logged row can carry: everything a runner reports, plus the
 * terminal 'deleted' the close-out writes for a workspace whose placement is
 * gone. The migration's CHECK constraint mirrors this type.
 */
type MeterPhase = ObservedPhase | 'deleted'

/** A row to append to the log. */
export interface RuntimeEventRow {
  workspace_id: string
  user_id: string
  /**
   * Where the workspace ran. A workspace can be re-placed onto a different
   * environment, so this moves with it and is part of the change comparison.
   */
  environment_id: string
  is_builtin: boolean
  phase: MeterPhase
  ready_replicas: number | null
  desired_replicas: number
  runtime_mode: RuntimeMode
  resources: ComputeResources
  spec_version: number | null
  observed_template_version: number | null
  env_offline: boolean
}

/** One workspace's current observation, next to the last one already logged. */
export interface RuntimeMeterRow extends RuntimeEventRow {
  last_environment_id: string | null
  last_phase: MeterPhase | null
  last_ready_replicas: number | null
  last_desired_replicas: number | null
  last_spec_version: number | null
  last_observed_template_version: number | null
  last_env_offline: boolean | null
}

const INSERT_COLUMNS = `workspace_id, user_id, environment_id, is_builtin, ts, phase,
       ready_replicas, desired_replicas, runtime_mode, resources, spec_version,
       observed_template_version, env_offline`

/**
 * Every placed workspace's current observation joined to its newest logged row,
 * so one query yields both sides of the comparison the meter makes.
 *
 * Reading the log back rather than remembering the last state in cp is what
 * makes the pass level-triggered: it converges on whatever is already stored, so
 * a restart, a failed write or a missed tick all self-correct on the next pass
 * instead of leaving a permanent hole.
 *
 * The ready-replica count stays null when the runner reported no set at all,
 * unlike getWorkspaceReplicaStatus() in ./env-placements, which collapses that
 * to 0. The distinction matters here and nowhere else: "not reported" and "zero
 * ready" would bill differently, so do not unify the two expressions.
 *
 * `thresholdSec` is how long without a heartbeat makes a remote environment
 * offline — the same rule the status projection applies, because an offline
 * environment's phase is a stale reading in both.
 */
export async function listRuntimeMeterRows(thresholdSec: number): Promise<RuntimeMeterRow[]> {
  const { rows } = await pool.query(
    `SELECT p.workspace_id,
            w.user_id,
            p.environment_id,
            e.is_builtin,
            COALESCE(p.observed_phase, 'unknown') AS phase,
            CASE WHEN jsonb_typeof(p.endpoint->'readyReplicaIds') = 'array'
                 THEN jsonb_array_length(p.endpoint->'readyReplicaIds') END AS ready_replicas,
            COALESCE((p.spec->>'replicas')::int, 1) AS desired_replicas,
            p.runtime_mode,
            COALESCE(p.spec->'resources', '{}'::jsonb) AS resources,
            p.spec_version,
            p.observed_template_version,
            ${ENV_OFFLINE_SQL} AS env_offline,
            last.environment_id AS last_environment_id,
            last.phase AS last_phase,
            last.ready_replicas AS last_ready_replicas,
            last.desired_replicas AS last_desired_replicas,
            last.spec_version AS last_spec_version,
            last.observed_template_version AS last_observed_template_version,
            last.env_offline AS last_env_offline
       FROM workspace_placements p
       JOIN environments e ON e.id = p.environment_id
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN LATERAL (
         SELECT r.environment_id, r.phase, r.ready_replicas, r.desired_replicas,
                r.spec_version, r.observed_template_version, r.env_offline
           FROM workspace_runtime_events r
          WHERE r.workspace_id = p.workspace_id
          ORDER BY r.ts DESC, r.id DESC
          LIMIT 1
       ) last ON true
      WHERE p.desired_phase <> 'deleted'`,
    [thresholdSec],
  )
  return rows as RuntimeMeterRow[]
}

/**
 * Append rows to the log, all stamped with one server-side `now()` so a pass
 * lands at a single instant rather than smeared across its own runtime.
 *
 * No dedup key, and none is needed even with two cp instances writing (a
 * rolling update): a row says "from here, this state", so a duplicate of the
 * same state splits one interval into two adjacent identical ones and sums to
 * exactly the same time. Nothing downstream has to reconcile it.
 */
export async function insertRuntimeEvents(rows: RuntimeEventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { rowCount } = await pool.query(
    `INSERT INTO workspace_runtime_events (${INSERT_COLUMNS})
     SELECT x.workspace_id, x.user_id, x.environment_id, x.is_builtin, now(), x.phase,
            x.ready_replicas, x.desired_replicas, x.runtime_mode, x.resources,
            x.spec_version, x.observed_template_version, x.env_offline
       FROM jsonb_to_recordset($1::jsonb) AS x(
         workspace_id TEXT, user_id TEXT, environment_id TEXT, is_builtin BOOLEAN, phase TEXT,
         ready_replicas INT, desired_replicas INT, runtime_mode TEXT, resources JSONB,
         spec_version INT, observed_template_version INT, env_offline BOOLEAN
       )`,
    [JSON.stringify(rows)],
  )
  return rowCount ?? 0
}

/**
 * Record that the meter ran: extend the newest coverage window to now, or open a
 * new one when the previous pass is further back than `gapSec`. Returns true
 * when a window was opened.
 *
 * The gap itself is not computed here — it is the distance between one window's
 * covered_through and the next window's started_at, which rating reads directly.
 * A gap is the meter's own downtime, not the workspaces': they keep running
 * while cp is not looking, so this records the blind spot rather than resolving
 * it.
 */
export async function markMeterCoverage(gapSec: number): Promise<boolean> {
  const { rows } = await pool.query(
    `WITH extended AS (
       UPDATE runtime_meter_windows w
          SET covered_through = now()
         FROM (SELECT id FROM runtime_meter_windows ORDER BY covered_through DESC LIMIT 1) newest
        WHERE w.id = newest.id
          AND w.covered_through >= now() - make_interval(secs => $1)
       RETURNING w.id
     )
     INSERT INTO runtime_meter_windows (started_at, covered_through)
     SELECT now(), now()
      WHERE NOT EXISTS (SELECT 1 FROM extended)
     RETURNING id`,
    [gapSec],
  )
  return rows.length > 0
}

/**
 * Close out workspaces whose placement is gone: the last row for them still says
 * they were running, and nothing will ever follow it because they no longer
 * appear in the meter's pass. Writes one terminal 'deleted' row each.
 *
 * `ids` is a loose index scan — the recursive walk that Postgres will not
 * generate for `DISTINCT ON`, which reads the whole log instead and so gets
 * slower forever as history accumulates. Here the work is one index descent per
 * distinct workspace, flat in the size of the log.
 *
 * Returns the ids closed.
 */
export async function closeDeletedWorkspaceIntervals(): Promise<string[]> {
  const { rows } = await pool.query(
    `WITH RECURSIVE ids AS (
       (SELECT workspace_id FROM workspace_runtime_events ORDER BY workspace_id LIMIT 1)
       UNION ALL
       SELECT (SELECT r.workspace_id
                 FROM workspace_runtime_events r
                WHERE r.workspace_id > ids.workspace_id
                ORDER BY r.workspace_id
                LIMIT 1)
         FROM ids
        WHERE ids.workspace_id IS NOT NULL
     ),
     open AS (
       SELECT last.*
         FROM ids
         CROSS JOIN LATERAL (
           SELECT r.workspace_id, r.user_id, r.environment_id, r.is_builtin, r.phase,
                  r.runtime_mode, r.resources, r.spec_version, r.observed_template_version
             FROM workspace_runtime_events r
            WHERE r.workspace_id = ids.workspace_id
            ORDER BY r.ts DESC, r.id DESC
            LIMIT 1
         ) last
        WHERE ids.workspace_id IS NOT NULL
     )
     INSERT INTO workspace_runtime_events (${INSERT_COLUMNS})
     SELECT o.workspace_id, o.user_id, o.environment_id, o.is_builtin, now(), 'deleted', 0, 0,
            o.runtime_mode, o.resources, o.spec_version, o.observed_template_version, false
       FROM open o
      WHERE o.phase <> 'deleted'
        AND NOT EXISTS (
          SELECT 1 FROM workspace_placements p
           WHERE p.workspace_id = o.workspace_id
             AND p.desired_phase <> 'deleted'
        )
     RETURNING workspace_id`,
  )
  return rows.map((r) => r.workspace_id as string)
}
