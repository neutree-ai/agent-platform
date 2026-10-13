import {
  type AgentCallDeliveryEntry,
  formatAgentCallDelivery,
} from '../../../../internal/types/agent-call-delivery'
import { isDraining } from '../../lib/sse'
import {
  type AgentCall,
  countAgentCallDeliveries,
  countOpenAgentCalls,
  dropAgentCallDelivery,
  endAgentCalls,
  failAgentCallDelivery,
  hasRunningCallAsChild,
  listParentsWithDeliverableCalls,
  listStaleRunningAgentCalls,
  markAgentCallInputRequested,
  markAgentCallsDelivered,
  releaseAgentCallDelivery,
  takeDeliverableAgentCalls,
} from '../db/agent-calls'
import { getLastAssistantMessage } from '../db/messages'
import { getSession } from '../db/sessions'
import type { Workspace } from '../db/types'
import { getWorkspace } from '../db/workspaces'

// Delivers the results of `call_agent` calls back to the session that made
// them. A call that outlives its tool call is recorded in `agent_calls`; when
// the called session's turn ends, its result is posted to the calling session
// as a new turn, so the calling agent can end its own turn instead of polling.
//
// Posting a result means starting a turn, which is chat dispatch's job. This
// module sits below chat dispatch, so every entry point takes the function
// that starts a turn (`StartTurn`) from its caller.
//
// Delivery is driven from the table. Whatever notices a change — a turn
// ending, or the sweep below — calls `deliverAgentCallResults` for the calling
// session, which is safe to call at any time and from any replica: it leases
// the rows it posts, and a session that is busy simply keeps its results until
// its turn ends.

/** How long a replica holds the results it is posting. Covers a cold workspace start. */
const DELIVERY_LEASE_SECONDS = 120
/** Failed posts before a result is dropped; one per lease, so about half an hour. */
const MAX_DELIVERY_ATTEMPTS = 15
/**
 * Turns one session may be given to deliver results. Past it the session's
 * further calls are not tracked, which stops two agents that keep calling each
 * other from running unattended forever.
 */
const MAX_DELIVERIES_PER_SESSION = 50
const SWEEP_INTERVAL_MS = 30_000
/** A call this young may not have its turn's claim written yet. */
const STALE_CALL_GRACE_SECONDS = 120
const SWEEP_BATCH = 200
/** Longest reply quoted in a delivery; the full text stays readable with get_agent_result. */
const RESULT_TEXT_LIMIT = 16_000

/**
 * Whether a session created this way takes deliveries. Whoever consumes the
 * session has to expect turns it did not start: the web client does, and API
 * clients are told to wait on `pending_agent_calls`. Schedules and chat
 * connectors read a single turn's reply, so their sessions do not.
 */
function sourceTakesDeliveries(source: string): boolean {
  switch (source) {
    case 'web':
    case 'api':
      return true
    default:
      return false
  }
}

/** Starts a turn in an existing session; `executeChat` in practice. */
type StartTurn = (opts: {
  workspace: Workspace
  message: string
  sessionId: string
  images: null
  source: string
  callerUserId?: string
}) => Promise<Response>

interface DeliveryTarget {
  parentSessionId: string
  callerUserId: string | null
}

/**
 * Decide whether calls made from this session are tracked for delivery.
 * Null means the caller keeps the result by polling, as it always could.
 */
export async function resolveDeliveryTarget(
  sessionId: string | null,
  workspaceId: string,
): Promise<DeliveryTarget | null> {
  if (!sessionId) return null
  const session = await getSession(sessionId)
  if (!session) return null
  if (session.workspace_id !== workspaceId) return null

  // A session an agent called takes deliveries while that call is itself
  // tracked: its own result is then held back until its calls have returned.
  const takesDeliveries =
    session.source === 'agent'
      ? await hasRunningCallAsChild(sessionId)
      : sourceTakesDeliveries(session.source)
  if (!takesDeliveries) return null

  const deliveries = await countAgentCallDeliveries(sessionId)
  if (deliveries >= MAX_DELIVERIES_PER_SESSION) {
    console.warn(
      `[agent-call] session=${sessionId} reached ${MAX_DELIVERIES_PER_SESSION} deliveries; further calls are not tracked`,
    )
    return null
  }
  return { parentSessionId: sessionId, callerUserId: session.caller_user_id }
}

interface TurnOutcome {
  /** `session.ended` reason, or null when the stream was lost before it. */
  reason: string | null
  error?: string | null
}

/**
 * A turn in this session is over. Records the outcome on the call that ran it
 * (if any) and posts whatever is now ready, both to the session that called
 * this one and to this session itself, which is free to take results again.
 */
export async function settleSessionTurn(
  sessionId: string,
  outcome: TurnOutcome,
  startTurn: StartTurn,
): Promise<void> {
  const closed = await closeCallsAsChild(sessionId, outcome)
  const parents = new Set(closed.map((c) => c.parent_session_id))
  for (const parent of parents) {
    await deliverAgentCallResults(parent, startTurn)
  }
  await deliverAgentCallResults(sessionId, startTurn)
}

async function closeCallsAsChild(sessionId: string, outcome: TurnOutcome): Promise<AgentCall[]> {
  if (outcome.reason !== 'completed') {
    const error = outcome.error ?? `turn ended with reason=${outcome.reason ?? 'stream lost'}`
    return endAgentCalls(sessionId, 'failed', error)
  }
  // The session ended its turn while still waiting on calls of its own: its
  // answer so far is interim, so the call stays running until those return
  // and a later turn ends with nothing outstanding.
  const open = await countOpenAgentCalls(sessionId)
  if (open > 0) return []
  return endAgentCalls(sessionId, 'ended', null)
}

/** The session's turn is parked on a question to its user: tell its caller once. */
export async function noteSessionInputRequested(
  sessionId: string,
  startTurn: StartTurn,
): Promise<void> {
  const calls = await markAgentCallInputRequested(sessionId)
  const parents = new Set(calls.map((c) => c.parent_session_id))
  for (const parent of parents) {
    await deliverAgentCallResults(parent, startTurn)
  }
}

/**
 * Post every result ready for this session as one turn. Does nothing when
 * there is none, so it can be called on any hint that there might be.
 */
export async function deliverAgentCallResults(
  parentSessionId: string,
  startTurn: StartTurn,
): Promise<void> {
  // A replica on its way out would start a turn it cannot see through.
  if (isDraining()) return

  const calls = await takeDeliverableAgentCalls(parentSessionId, DELIVERY_LEASE_SECONDS)
  if (calls.length === 0) return
  const ids = calls.map((c) => c.id)

  try {
    const session = await getSession(parentSessionId)
    if (!session) {
      await dropUndeliverable(parentSessionId, ids, 'calling session was deleted')
      return
    }
    if (session.status !== 'active') {
      await dropUndeliverable(parentSessionId, ids, `calling session is ${session.status}`)
      return
    }
    const workspace = await getWorkspace(session.workspace_id)
    if (!workspace) {
      await dropUndeliverable(parentSessionId, ids, 'calling workspace was deleted')
      return
    }

    const message = await buildDeliveryMessage(parentSessionId, calls)
    const resp = await startTurn({
      workspace,
      message,
      sessionId: parentSessionId,
      images: null,
      source: 'agent',
      callerUserId: calls[0].caller_user_id ?? undefined,
    })

    if (resp.headers.get('Content-Type')?.includes('text/event-stream')) {
      // The turn streams, persists and broadcasts on its own; nobody reads
      // this copy of the stream.
      void resp.body?.cancel().catch(() => {})
      await markAgentCallsDelivered(ids)
      console.log(`[agent-call] delivered ${ids.length} result(s) to session=${parentSessionId}`)
      return
    }
    if (resp.status === 409) {
      // A turn is running in the calling session. The results wait in the
      // table and are posted when that turn ends.
      await releaseAgentCallDelivery(ids)
      return
    }
    await failAgentCallDelivery(ids, MAX_DELIVERY_ATTEMPTS, `chat dispatch returned ${resp.status}`)
    console.warn(
      `[agent-call] delivery to session=${parentSessionId} failed with status ${resp.status}; will retry`,
    )
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e)
    await failAgentCallDelivery(ids, MAX_DELIVERY_ATTEMPTS, note).catch(() => {})
    console.error(`[agent-call] delivery to session=${parentSessionId} threw:`, e)
  }
}

async function dropUndeliverable(
  parentSessionId: string,
  ids: string[],
  note: string,
): Promise<void> {
  await dropAgentCallDelivery(ids, note)
  console.warn(
    `[agent-call] dropped ${ids.length} result(s) for session=${parentSessionId}: ${note}`,
  )
}

/** The message the calling agent reads; see internal/types/agent-call-delivery. */
async function buildDeliveryMessage(parentSessionId: string, calls: AgentCall[]): Promise<string> {
  const entries: AgentCallDeliveryEntry[] = []
  let finished = 0
  for (const call of calls) {
    const workspace = await getWorkspace(call.child_workspace_id)
    const agent = workspace
      ? `${workspace.name}${workspace.slug ? ` (@agent/${workspace.slug})` : ''}`
      : 'an agent that no longer exists'
    const entry = { agent, sessionId: call.child_session_id }

    if (call.status === 'running') {
      entries.push({ ...entry, status: 'needs_input', text: '' })
      continue
    }

    finished++
    const last = await getLastAssistantMessage(call.child_session_id)
    const text = quoteReply(last?.content ?? '')
    if (call.status === 'failed') {
      entries.push({ ...entry, status: 'failed', text, error: call.error ?? 'unknown error' })
      continue
    }
    entries.push({ ...entry, status: 'ended', text })
  }

  // The finished calls in this message are still counted as open until the
  // post succeeds.
  const stillRunning = (await countOpenAgentCalls(parentSessionId)) - finished
  return formatAgentCallDelivery(entries, stillRunning)
}

function quoteReply(text: string): string {
  if (text.length <= RESULT_TEXT_LIMIT) return text
  return `${text.slice(0, RESULT_TEXT_LIMIT)}\n...[truncated; read the full reply with get_agent_result]`
}

let sweeping = false

/**
 * The fallback for everything the turn-end path can miss: a replica that went
 * away mid-turn, a post that failed, a session that was busy and whose turn
 * then ended on another replica.
 */
async function sweepAgentCalls(startTurn: StartTurn): Promise<void> {
  if (sweeping || isDraining()) return
  sweeping = true
  try {
    const parents = new Set<string>()
    const stale = await listStaleRunningAgentCalls(STALE_CALL_GRACE_SECONDS, SWEEP_BATCH)
    for (const { child_session_id, session_gone } of stale) {
      const closed = session_gone
        ? await endAgentCalls(child_session_id, 'failed', 'the called session was deleted')
        : await endAgentCalls(child_session_id, 'ended', null)
      for (const call of closed) parents.add(call.parent_session_id)
    }
    for (const parent of await listParentsWithDeliverableCalls(SWEEP_BATCH)) {
      parents.add(parent)
    }
    for (const parent of parents) {
      await deliverAgentCallResults(parent, startTurn)
    }
  } finally {
    sweeping = false
  }
}

export function startAgentCallSweep(startTurn: StartTurn): void {
  const timer = setInterval(() => {
    sweepAgentCalls(startTurn).catch((e) => console.error('[agent-call] sweep failed:', e))
  }, SWEEP_INTERVAL_MS)
  timer.unref?.()
}
