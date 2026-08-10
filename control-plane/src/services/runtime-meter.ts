import {
  type RuntimeEventRow,
  type RuntimeMeterRow,
  insertRuntimeEvents,
  listRuntimeMeterRows,
  markMeterCoverage,
} from './db/runtime-meter'

// Runtime metering — the raw half of workspace billing.
//
// Each pass reads what every placed workspace is observed to be and appends a
// row wherever that differs from the newest row already logged. An interval runs
// from one row to the next, so the log needs no closing row, no pairing, and no
// repair after a crash: whatever state a workspace is in, the next pass records
// it, and the intervals still add up.
//
// The pass is level-triggered rather than hooked onto status transitions. It has
// to be: replica count and pod size change without the status ever leaving
// 'running', so an edge hook on applyStatusChange would miss exactly the
// variation billing is about. Reading the log back each pass is also what makes
// a dropped write self-correcting — the state still differs next time.
//
// Nothing here prices anything; see migration 134 for why the log is raw.

/** How far back the previous pass may be before the meter counts it as a gap. */
const COVERAGE_GAP_SEC = Number(process.env.RUNTIME_METER_GAP_SEC) || 60

/**
 * Whether a workspace's current observation differs from the newest logged row.
 *
 * Two fields are deliberately outside the comparison. `resources` is covered by
 * spec_version, since every path that changes a workspace's sizing goes through
 * bumpWorkspaceSpec. `runtime_mode` is fixed when the workspace is created and
 * cannot change at all — it is logged so a rated row needs no join to a
 * placement that will be deleted with the workspace, not because it can move.
 * `is_builtin` follows environment_id, which is compared: a workspace can be
 * re-placed onto another environment, and that has to split the interval
 * because where it ran decides who is billed for it.
 *
 * A workspace with no rows at all always counts as changed: the log needs an
 * opening anchor for it.
 */
export function stateChanged(row: RuntimeMeterRow): boolean {
  return (
    row.last_phase === null ||
    row.environment_id !== row.last_environment_id ||
    row.phase !== row.last_phase ||
    row.ready_replicas !== row.last_ready_replicas ||
    row.desired_replicas !== row.last_desired_replicas ||
    row.spec_version !== row.last_spec_version ||
    row.observed_template_version !== row.last_observed_template_version ||
    row.env_offline !== row.last_env_offline
  )
}

/** Drop the comparison columns, leaving exactly the row to append. */
function toEvent(row: RuntimeMeterRow): RuntimeEventRow {
  const {
    last_environment_id,
    last_phase,
    last_ready_replicas,
    last_desired_replicas,
    last_spec_version,
    last_observed_template_version,
    last_env_offline,
    ...event
  } = row
  return event
}

/**
 * One metering pass: log every workspace whose observed state moved, then mark
 * the pass's own coverage.
 *
 * Coverage is marked last on purpose. It means "the meter logged successfully up
 * to here", so a failed write leaves it behind and, if the failure persists past
 * the gap threshold, the outage shows up in the windows table instead of being
 * silently papered over.
 */
export async function runRuntimeMeter(thresholdSec: number): Promise<void> {
  const changed = (await listRuntimeMeterRows(thresholdSec)).filter(stateChanged).map(toEvent)
  if (changed.length > 0) {
    await insertRuntimeEvents(changed)
    console.log(`[RuntimeMeter] logged ${changed.length} state change(s)`)
  }

  if (await markMeterCoverage(COVERAGE_GAP_SEC)) {
    console.log('[RuntimeMeter] opened a new coverage window — the previous pass is a gap behind')
  }
}
