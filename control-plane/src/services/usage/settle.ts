import { DEFAULT_SETTLE_GRACE_MS } from '../../../../internal/agent-usage/src/index'
import { type SessionSettlementFacts, getSessionSettlementFacts } from '../db/workspace-usage'
import { pullWorkspaceUsage } from './pull'

/**
 * Whether the ledger holds everything a session spent.
 *
 * Usage reaches the ledger by pulling the agent's transcripts, and the pull on
 * `session.ended` is detached — so a caller reading straight after a run has no
 * way to tell a cheap run from an account that has not arrived. Rather than
 * have every consumer guess at a delay, the answer is derived and reported.
 *
 * The account is complete when a pull read the workspace to the end at a moment
 * far enough past the session's last activity that the parser was no longer
 * withholding anything. Both halves are load-bearing: draining alone proves the
 * agent had nothing more to give *at that moment*, and the grace is what makes
 * "that moment" cover the entry the parser was still holding back.
 */

/** Why an account is not complete. Null when it is. */
type SettlementReason =
  | 'turn_in_progress'
  | 'pending_settle'
  | 'agent_unreachable'
  | 'workspace_gone'

interface Settlement {
  complete: boolean
  /** When a pull last read this workspace to the end. */
  drained_through: string | null
  /** Latest activity cp can see for the session; the grace is measured from here. */
  activity_at: string | null
  reason: SettlementReason | null
}

/** Shortest gap between two background pulls of one workspace. */
const PULL_MIN_INTERVAL_MS = 2_000

/**
 * Why an incomplete account is incomplete — read off the same facts as the
 * verdict rather than off the last pull's outcome, so it means the same thing
 * on every cp replica and survives a restart. It separates "wait, this is
 * converging" from "waiting will not help", which is all a polling caller
 * needs to decide whether to keep going.
 */
function reasonFor(facts: SessionSettlementFacts): SettlementReason {
  if (facts.chat_status === 'agent') return 'turn_in_progress'
  if (facts.workspace_status === null) return 'workspace_gone'
  // Transcripts are read out of the running pod; a stopped workspace keeps them
  // on its volume, but nothing can collect them until it runs again.
  if (facts.workspace_status !== 'running') return 'agent_unreachable'
  return 'pending_settle'
}

/**
 * Decide a verdict from already-gathered facts. Pure, so the rule can be tested
 * against the clock skews it exists to handle without a database or an agent.
 */
export function evaluateSettlement(facts: SessionSettlementFacts): Settlement {
  const base = {
    drained_through: facts.drained_through,
    activity_at: facts.activity_at,
  }
  // A turn still running will write more; nothing observed so far can be final.
  const settled =
    facts.chat_status !== 'agent' &&
    facts.drained_through !== null &&
    // No activity at all: the drain found the session had nothing to account for.
    (facts.activity_at === null ||
      new Date(facts.drained_through).getTime() - DEFAULT_SETTLE_GRACE_MS >
        new Date(facts.activity_at).getTime())

  return settled
    ? { ...base, complete: true, reason: null }
    : { ...base, complete: false, reason: reasonFor(facts) }
}

// Last time a background pull was started per workspace. Together with the
// in-flight map this bounds how much agent traffic a polling client can cause:
// concurrent reads share one round trip, and a fast poll cannot start a new one
// more often than PULL_MIN_INTERVAL_MS.
const inFlight = new Map<string, Promise<unknown>>()
const lastPullAt = new Map<string, number>()

/**
 * Nudge a workspace's usage forward without making the caller wait for it.
 *
 * The pull on `session.ended` fires while the transcript is still inside its
 * settle grace, so it drains but cannot cover the entry the parser is holding
 * back. Nothing else pulls until the half-hourly sweep — a client polling a
 * purely passive read would sit at `complete: false` for that long. Reading an
 * unsettled account is therefore what schedules the next pull, which makes a
 * poll loop converge in seconds while keeping the read itself a database query.
 */
function schedulePull(workspaceId: string, workspaceStatus: string | null): void {
  const now = Date.now()
  // Only a running workspace can be read; anything else already says so in the
  // verdict's reason, and pulling it would just burn a request to find out.
  if (workspaceStatus !== 'running') return
  if (inFlight.has(workspaceId)) return
  if (now - (lastPullAt.get(workspaceId) ?? 0) < PULL_MIN_INTERVAL_MS) return

  lastPullAt.set(workspaceId, now)
  const p = pullWorkspaceUsage(workspaceId)
    .catch((e) =>
      console.warn(`[usage] settle pull ws=${workspaceId}:`, e instanceof Error ? e.message : e),
    )
    .finally(() => inFlight.delete(workspaceId))
  inFlight.set(workspaceId, p)
}

/**
 * Report whether a session's account is complete.
 *
 * Always a plain read — the verdict describes what the ledger holds right now,
 * never what a pull might be about to add. An incomplete answer schedules a
 * pull in the background so the next read can differ; poll until `complete`.
 */
export async function settleSessionUsage(
  workspaceId: string,
  sessionId: string,
): Promise<Settlement> {
  const facts = await getSessionSettlementFacts(workspaceId, sessionId)
  const result = evaluateSettlement(facts)
  if (!result.complete) schedulePull(workspaceId, facts.workspace_status)
  return result
}
