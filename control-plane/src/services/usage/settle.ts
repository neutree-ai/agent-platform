import { DEFAULT_SETTLE_GRACE_MS } from '../../../../internal/agent-usage/src/index'
import { type SessionSettlementFacts, getSessionSettlementFacts } from '../db/workspace-usage'
import { type PullStop, pullWorkspaceUsage } from './pull'

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

/** Stops that no amount of retrying will get past. */
const TERMINAL: PullStop[] = ['workspace_gone']

/** How long a `wait` request sleeps between attempts. */
const POLL_INTERVAL_MS = 3_000

/** Upper bound on `wait`, so a caller cannot pin a request open indefinitely. */
export const MAX_WAIT_SEC = 60

function reasonFor(facts: SessionSettlementFacts, stop: PullStop | null): SettlementReason {
  if (facts.chat_status === 'agent') return 'turn_in_progress'
  if (stop === 'workspace_gone') return 'workspace_gone'
  if (stop === 'agent_unreachable' || stop === 'agent_error') return 'agent_unreachable'
  // 'batch_cap' included: the drain is real progress, just unfinished.
  return 'pending_settle'
}

/**
 * Decide a verdict from already-gathered facts. Pure, so the rule can be tested
 * against the clock skews it exists to handle without a database or an agent.
 */
export function evaluateSettlement(
  facts: SessionSettlementFacts,
  stop: PullStop | null,
): Settlement {
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
    : { ...base, complete: false, reason: reasonFor(facts, stop) }
}

// Collapses concurrent pulls of the same workspace onto one round trip. Several
// clients waiting on sibling sessions of one workspace is the expected shape,
// and each pull is a full drain — without this they would multiply into
// redundant load on the agent for an answer they all share.
const inFlight = new Map<string, Promise<PullStop>>()

function pullOnce(workspaceId: string): Promise<PullStop> {
  const existing = inFlight.get(workspaceId)
  if (existing) return existing
  const p = pullWorkspaceUsage(workspaceId)
    .then((o) => o.stop)
    .catch((e): PullStop => {
      console.warn(`[usage] settle pull ws=${workspaceId}:`, e instanceof Error ? e.message : e)
      return 'agent_error'
    })
    .finally(() => inFlight.delete(workspaceId))
  inFlight.set(workspaceId, p)
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Report whether a session's account is complete, optionally pulling and
 * waiting for it to become so.
 *
 * With `waitSec` unset this only reads what is already known — no round trip to
 * the agent. With it set, the wait ends the moment the account settles, at the
 * deadline, or on a stop that retrying cannot fix; a timeout returns the real
 * verdict rather than pretending to have succeeded.
 */
export async function settleSessionUsage(
  workspaceId: string,
  sessionId: string,
  waitSec = 0,
): Promise<Settlement> {
  if (waitSec <= 0) {
    return evaluateSettlement(await getSessionSettlementFacts(workspaceId, sessionId), null)
  }

  const deadline = Date.now() + Math.min(waitSec, MAX_WAIT_SEC) * 1000
  let stop: PullStop | null = null
  while (true) {
    stop = await pullOnce(workspaceId)
    const result = evaluateSettlement(await getSessionSettlementFacts(workspaceId, sessionId), stop)
    if (result.complete || TERMINAL.includes(stop)) return result

    const remaining = deadline - Date.now()
    if (remaining <= 0) return result
    await sleep(Math.min(POLL_INTERVAL_MS, remaining))
  }
}
