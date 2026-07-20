import { type TurnPlugin, runTurn } from '../../../internal/sse-consumer/src'
import type { TurnStats, UniversalEvent } from '../../../internal/types/events'
import {
  addMessage,
  insertEvent,
  insertUserMessageBlocks,
  updateMessageContent,
  upsertEvent,
} from '../services/db/messages'
import {
  createSession,
  setSessionReplicaOrdinal,
  transitionSessionStatus,
  updateSessionActivity,
  updateSessionStats,
} from '../services/db/sessions'
import { getWorkspace } from '../services/db/workspaces'
import { notify } from '../services/notifications'
import { pullWorkspaceUsage } from '../services/usage/pull'
import { setSseStreamCountProvider, sseStreamDuration } from './metrics'
import { bindSession as bindSessionToken } from './session-token'
import { truncateToolOutput } from './truncate-tool-output'

// ── Active SSE stream tracking for client reconnect ──

const encoder = new TextEncoder()

/**
 * Idle heartbeat to keep cp → client TCP warm. Mirrors the acp-adapter fix
 * (`fix(acp-adapter): SSE comment-line heartbeat to keep cp↔agent stream
 * warm`) at the next hop: long quiet stretches (agent waiting on a slow
 * model call, IDC↔upstream blips) used to let kube-proxy / conntrack /
 * undici recycle the cp → scheduler-or-web socket and surface as
 * `TypeError: terminated` even when the agent kept running. A `:` SSE
 * comment frame is ignored by SSE readers but resets the TCP idle timer.
 */
const HEARTBEAT_MS = 15_000
const HEARTBEAT_FRAME = encoder.encode(': \n\n')

interface ActiveSSEStream {
  workspaceId: string
  controllers: Set<ReadableStreamDefaultController<Uint8Array>>
  done: boolean
  doneResolve: () => void
  donePromise: Promise<void>
  /**
   * The serial write queue shared by the stream's plugins. `drainActiveStreams`
   * flushes these on shutdown so in-flight DB writes (events the plugins have
   * already accepted but not yet persisted) commit before the process exits.
   */
  queue?: SerialQueue
  lastEmitAt: number
  heartbeatTimer?: ReturnType<typeof setInterval>
  /**
   * True between the turn's `session.started` and its `session.ended` /
   * `question.requested`. Drives `tos_sse_active_streams`: the stream object
   * outlives the turn (it stays mapped until `runTurn` resolves, up to the
   * 24h idle timeout), so "is a turn running" must be tracked separately
   * from "does the stream object still exist".
   */
  turnActive: boolean
}

// Key: "workspaceId:sessionId" for session-level isolation (supports concurrent streams)
export const activeStreams = new Map<string, ActiveSSEStream>()

// Derive both SSE gauges from `activeStreams` on every Prometheus scrape
// rather than hand-incrementing. A manual counter inevitably drifts here: a
// stream's `inc()` happens at creation but its `dec()` only at `runTurn`
// resolve, which a silently-dead agent can defer for up to 24h — leaving the
// gauge stuck high. Deriving on read makes both metrics structurally exact.
//   - active: turns actually in progress (== sessions in chat_status
//     'agent'); excludes stream objects whose turn already ended.
//   - open:   every live stream object; the gap vs active is the count of
//     finished turns awaiting reclaim (zombie candidates).
setSseStreamCountProvider(() => {
  let active = 0
  for (const s of activeStreams.values()) {
    if (!s.done && s.turnActive) active++
  }
  return { active, open: activeStreams.size }
})

// Set to true once `drainActiveStreams` begins. Consulted by the reconnect
// factory wrapper in `createInterceptedSSEResponse` and `runSubAgentTurn` so
// that a CP process already on its way out stops initiating new outbound
// `/reconnect` calls to agents — those would otherwise race a replacement
// pod's fresh recovery reconnect and replace `sink.write` with a dying writer.
let draining = false

export function isDraining(): boolean {
  return draining
}

/**
 * Flush all in-flight DB writes before CP exits.
 *
 * With `recoverOrphanedSessions` picking up `chat_status='agent'` sessions on
 * the next CP boot, the old "wait 2 minutes for every turn to reach
 * session.ended" behaviour is no longer needed — the replacement pod will
 * reconnect and finish the turn. What drain still owes the caller is
 * durability for events that have already been accepted into plugin state
 * but haven't been committed to DB yet. We flush each stream's `SerialQueue`
 * with a short budget and call it done.
 */
export async function drainActiveStreams(timeoutMs = 5_000): Promise<void> {
  draining = true
  const streams = [...activeStreams.values()].filter((s) => !s.done)
  if (streams.length === 0) return
  console.log(
    `[SSE] Draining ${streams.length} active stream(s), timeout=${timeoutMs}ms (flush-only)`,
  )
  const flushes = streams
    .map((s) => s.queue)
    .filter((q): q is SerialQueue => q !== undefined)
    .map((q) => q.flush())
  const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
  await Promise.race([Promise.all(flushes), timeout])
  const remaining = [...activeStreams.values()].filter((s) => !s.done).length
  if (remaining > 0) {
    console.log(`[SSE] Drain timeout, ${remaining} stream(s) still active, closing`)
    for (const s of activeStreams.values()) {
      if (!s.done) {
        for (const c of s.controllers) {
          try {
            c.close()
          } catch {}
        }
        s.controllers.clear()
        s.doneResolve()
        s.done = true
      }
      if (s.heartbeatTimer) {
        clearInterval(s.heartbeatTimer)
        s.heartbeatTimer = undefined
      }
    }
  }
}

export function streamKey(workspaceId: string, sessionId: string | null): string {
  return sessionId ? `${workspaceId}:${sessionId}` : `${workspaceId}:new-${crypto.randomUUID()}`
}

/**
 * Register a new `ActiveSSEStream` in the `activeStreams` map for the given
 * workspace/session, evicting any previous entry under the same key. Shared
 * setup between `createInterceptedSSEResponse` (main chat path) and
 * `runSubAgentTurn` (call_agent path) so both expose the same live broadcast
 * surface to `/cp-reconnect`.
 */
export function setupActiveStream(
  workspaceId: string,
  existingSessionId: string | null,
  queue?: SerialQueue,
): {
  activeStream: ActiveSSEStream
  getActiveKey: () => string
  setActiveKey: (key: string) => void
} {
  let activeKey = streamKey(workspaceId, existingSessionId)

  const prev = activeStreams.get(activeKey)
  if (prev) {
    for (const c of prev.controllers) {
      try {
        c.close()
      } catch {}
    }
    prev.controllers.clear()
    prev.doneResolve()
    activeStreams.delete(activeKey)
    if (!prev.done) {
      prev.done = true
    }
    if (prev.heartbeatTimer) {
      clearInterval(prev.heartbeatTimer)
      prev.heartbeatTimer = undefined
    }
  }

  let doneResolve!: () => void
  const donePromise = new Promise<void>((r) => {
    doneResolve = r
  })
  const activeStream: ActiveSSEStream = {
    workspaceId,
    controllers: new Set(),
    done: false,
    doneResolve,
    donePromise,
    queue,
    lastEmitAt: Date.now(),
    // Not yet in a turn — flipped true once `session.started` is observed.
    turnActive: false,
  }
  activeStreams.set(activeKey, activeStream)
  startHeartbeat(activeStream)

  return {
    activeStream,
    getActiveKey: () => activeKey,
    setActiveKey: (key) => {
      activeKey = key
    },
  }
}

/** Find any active stream for a workspace (for reconnect when sessionId unknown) */
function findStreamByWorkspace(workspaceId: string): ActiveSSEStream | undefined {
  for (const stream of activeStreams.values()) {
    if (stream.workspaceId === workspaceId) return stream
  }
  return undefined
}

/** Write an SSE event to all connected clients. */
function emitSSE(stream: ActiveSSEStream, sseText: string) {
  if (stream.controllers.size === 0) return
  stream.lastEmitAt = Date.now()
  const encoded = encoder.encode(sseText)
  for (const c of stream.controllers) {
    try {
      c.enqueue(encoded)
    } catch {
      stream.controllers.delete(c)
    }
  }
}

/**
 * Start the idle-keepalive ticker. Writes a `:` SSE comment frame whenever
 * the stream has been silent for HEARTBEAT_MS. Self-clears when the stream
 * is marked done. `unref()` so it never blocks process exit on its own.
 */
function startHeartbeat(stream: ActiveSSEStream): void {
  stream.lastEmitAt = Date.now()
  const timer = setInterval(() => {
    if (stream.done) {
      clearInterval(timer)
      stream.heartbeatTimer = undefined
      return
    }
    if (stream.controllers.size === 0) return
    if (Date.now() - stream.lastEmitAt < HEARTBEAT_MS) return
    stream.lastEmitAt = Date.now()
    for (const c of stream.controllers) {
      try {
        c.enqueue(HEARTBEAT_FRAME)
      } catch {
        stream.controllers.delete(c)
      }
    }
  }, HEARTBEAT_MS)
  // Heartbeats alone shouldn't keep the event loop alive.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  stream.heartbeatTimer = timer
}

/**
 * Create an SSE response for reconnecting to an active stream.
 * Attaches as live client to receive subsequent events; the caller
 * is expected to have already loaded persisted history from the DB.
 * Returns null if no matching active stream exists.
 *
 * Resolution is session-scoped when `sessionId` is given: a workspace can
 * carry several concurrent turns (scheduler `max_concurrency`, multiple
 * browser tabs), each its own `ActiveSSEStream` keyed `workspaceId:sessionId`.
 * Looking up by session id attaches the caller to *its own* turn instead of
 * an arbitrary one. The workspace-wide `findStreamByWorkspace` path is a
 * legacy fallback for callers that don't pass a session id — every current
 * caller (web post-refresh, scheduler) has a concrete session id by the time
 * it reconnects.
 */
export function createReconnectSSEResponse(
  workspaceId: string,
  sessionId?: string | null,
): Response | null {
  const stream = sessionId
    ? activeStreams.get(streamKey(workspaceId, sessionId))
    : findStreamByWorkspace(workspaceId)
  if (!stream) return null

  // Stream already finished — clean up and return null.
  // The completed turn's messages are already persisted to DB;
  // the client will pick them up via loadHistory, not SSE replay.
  if (stream.done) {
    for (const [key, s] of activeStreams) {
      if (s === stream) {
        activeStreams.delete(key)
        break
      }
    }
    return null
  }

  let myController: ReadableStreamDefaultController<Uint8Array> | null = null

  const clientReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      myController = controller
      console.log(`[SSE] Reconnect: attaching live client workspace=${workspaceId}`)
      stream.controllers.add(controller)
    },
    cancel() {
      console.log(`[SSE] Reconnect client disconnected workspace=${workspaceId}`)
      if (myController) stream.controllers.delete(myController)
    },
  })

  return new Response(clientReadable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Intercept an agent SSE stream and tee it to: (1) persistent DB state and
 * (2) every connected client via `activeStream.controllers`.
 *
 * Delegates parsing + lifecycle / idle-timeout / plugin dispatch to
 * `runTurn` from `sse-consumer`. A single combined plugin owns both the
 * persistence state machine and the broadcast concerns — the plugin can
 * defer broadcast of `session.ended` / `question.requested` via the same
 * serial `writeChain` as the DB writes, preserving the invariant that the
 * client never sees a session-state transition before the DB reflects it.
 *
 * Step 2 of the migration will split persistence and broadcast into two
 * distinct plugins.
 */
interface InterceptedSSEOptions {
  workspaceId: string
  /** User prompt to persist once the session id is known; null when already persisted (or none). */
  userMessageText: string | null
  /** Session being resumed, or null when the agent will create a new one. */
  existingSessionId: string | null
  userImages?: Array<{ data: string; media_type: string }> | null
  callerUserId?: string
  source?: string
  /**
   * Optional reconnect factory. When provided and the primary agent
   * stream ends before `session.ended`, `runTurn` calls this with the
   * current sessionId. The factory should `POST /sessions/:id/reconnect`
   * on the target agent and return its SSE Response, or `null` if there
   * is nothing to replay. This is the direct fix for the CP → agent
   * mid-turn disconnect issue — when a reconnect recovers the buffered
   * events, the persist plugin keeps writing the same assistant message
   * and the broadcast plugin keeps fanning out to live clients, all
   * transparently.
   */
  reconnectFactory?: (sessionId: string) => Promise<Response | null>
  /**
   * Optional pre-existing assistant message to resume. Used by the
   * session-recovery path so replayed events append to the row already
   * in DB instead of creating a duplicate.
   */
  initialAssistant?: {
    id: string
    content: string
    blocks: InterceptContentPart[]
  }
  /**
   * Token the dispatcher passed to the agent in `/chat` body. The persist
   * plugin binds it to the SDK-revealed `session_id` on `session.started`
   * so MCP requests can reverse-resolve. Omit on reconnect-only paths
   * where dispatch already happened and the bind is already in place.
   */
  sessionToken?: string | null
  /**
   * Fired once when a brand-new session is created. Used by teamwork to
   * register the coordinator session into `teamwork_sessions` so MCP-time
   * session→task reverse lookup can succeed on the very first tool call.
   */
  onNewSession?: (sessionId: string) => Promise<void>
  /**
   * The auto-scaling replica this turn was routed to, from the replica router.
   * Persisted onto the session row on `session.started` so the session's next
   * turns pin to the same replica (shared-volume transcript safety). Undefined
   * for static single-replica workspaces — the binding stays NULL.
   */
  replicaId?: number
  /**
   * Fired exactly once when the turn terminates — clean end, error, interrupt,
   * or the agent pod dying mid-turn — after the stream is fully done. The turn
   * gate hangs the admission-slot release here so capacity is freed on every
   * termination path, including pod death (the slot-leak risk).
   */
  onTurnEnd?: () => void
}

export function createInterceptedSSEResponse(
  response: Response,
  opts: InterceptedSSEOptions,
): Response {
  const {
    workspaceId,
    userMessageText,
    existingSessionId,
    userImages,
    callerUserId,
    source = 'web',
    reconnectFactory,
    initialAssistant,
    sessionToken,
    onNewSession,
    replicaId,
    onTurnEnd,
  } = opts
  if (!response.body) {
    // No stream to intercept — the turn is over before it began. Fire the
    // end hook here so the admission slot is still released exactly once.
    onTurnEnd?.()
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Shared between persist and broadcast plugins:
  //   - `queue` serializes DB writes AND deferred broadcast emits, so the
  //     client never sees a state-transition event before the DB reflects it.
  //   - `state` lets broadcast read the latest sessionId / sessionEndedSeen
  //     flag written by persist, without duplicating event parsing.
  // `queue` is also attached to the activeStream below so `drainActiveStreams`
  // can flush pending DB writes on shutdown.
  const queue = new SerialQueue()
  const state: MainTurnSharedState = {
    sessionId: existingSessionId,
    sessionEndedSeen: false,
    endReason: null,
  }

  // Register this turn in the `activeStreams` map and evict any stale
  // entry under the same key.
  const { activeStream, getActiveKey, setActiveKey } = setupActiveStream(
    workspaceId,
    existingSessionId,
    queue,
  )

  // Create client ReadableStream
  let myController: ReadableStreamDefaultController<Uint8Array> | null = null
  const clientReadable = new ReadableStream<Uint8Array>({
    start(controller) {
      myController = controller
      activeStream.controllers.add(controller)
    },
    cancel() {
      console.log(`[SSE] Client disconnected ${workspaceId}`)
      if (myController) activeStream.controllers.delete(myController)
    },
  })

  const streamStartedAt = Date.now()
  const tag = `workspace=${workspaceId} source=${source}`
  console.log(`[SSE] Start intercepting ${tag} existingSession=${existingSessionId}`)

  const persistPlugin = createPersistMainTurnPlugin({
    workspaceId,
    userMessageText,
    userImages,
    callerUserId,
    source,
    tag,
    streamStartedAt,
    state,
    queue,
    initialAssistant,
    sessionToken,
    onNewSession,
    replicaId,
  })
  const broadcastPlugin = createBroadcastPlugin({
    workspaceId,
    existingSessionId,
    tag,
    streamStartedAt,
    activeStream,
    getActiveKey,
    setActiveKey,
    state,
    queue,
  })

  // Fire-and-forget. The Response we return wraps `clientReadable`, which
  // is already attached to `activeStream.controllers`, so the broadcast
  // pipeline is hot the moment this function returns.
  //
  // Plugin order matters: persist runs first so its DB enqueues land on
  // the shared queue before broadcast's deferred emits, ensuring emits
  // observe a consistent DB state.
  // Tap the raw agent stream: any byte from the agent — a real event OR the
  // acp-adapter heartbeat comment — proves the session is alive, so bump
  // last_active_at (throttled). Previously last_active_at only advanced when a
  // message/tool_result was persisted, so a single long operation (a slow tool,
  // a long inference with no streamed text) starved it and looked "stalled" to
  // the orchestrator's stall detector even while the agent was working.
  let lastActivityTouchAt = 0
  const ACTIVITY_TOUCH_THROTTLE_MS = 10_000
  const tapActivity = (resp: Response | null): Response | null => {
    if (!resp?.body) return resp
    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const sid = state.sessionId
        const now = Date.now()
        if (sid && now - lastActivityTouchAt >= ACTIVITY_TOUCH_THROTTLE_MS) {
          lastActivityTouchAt = now
          void updateSessionActivity(sid).catch(() => {})
        }
        controller.enqueue(chunk)
      },
    })
    return new Response(resp.body.pipeThrough(tap), {
      status: resp.status,
      headers: resp.headers,
    })
  }

  runTurn(
    {
      stream: async () => tapActivity(response) ?? response,
      reconnect: reconnectFactory
        ? async () => {
            // During shutdown this CP is already on its way out; firing a
            // new `/reconnect` POST here would race the replacement pod's
            // recovery reconnect and leave the sink pointing at a writer
            // that nothing reads. Let the new CP own the recovery.
            if (isDraining()) {
              console.log(`[SSE] Skip reconnect ${tag} — CP is shutting down`)
              return null
            }
            const sid = state.sessionId
            if (!sid) return null
            try {
              return tapActivity(await reconnectFactory(sid))
            } catch (e) {
              console.error(`[SSE] reconnect factory threw ${tag} session=${sid}:`, e)
              return null
            }
          }
        : undefined,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    },
    [persistPlugin, broadcastPlugin],
  )
    .catch((e) => {
      console.error(`[SSE] runTurn unexpectedly threw ${tag}:`, e)
    })
    .finally(() => {
      // The turn is fully terminated here (clean end, error, interrupt, or
      // pod death). Release the admission slot exactly once — before the drain
      // below, whose dispatched follow-up acquires its own slot.
      onTurnEnd?.()
      // After a cleanly-completed turn, dispatch any follow-up the user
      // queued mid-turn. This runs once `runTurn` has fully resolved — both
      // plugins' `onEnd` are done and `activeStreams` is cleaned up — so the
      // drained turn registers its own stream without racing this teardown.
      // A turn that errored or was interrupted does not drain: the draft is
      // left in place for the user to decide. Skip while CP is shutting
      // down — startup recovery on the next pod owns the drain instead.
      if (
        state.sessionEndedSeen &&
        state.endReason === 'completed' &&
        state.sessionId &&
        !isDraining()
      ) {
        const sid = state.sessionId
        // Dynamic import: executeChat statically imports this module, so a
        // static import here would form an initialization cycle.
        void import('../services/chat/executeChat')
          .then(({ drainPendingMessage }) => drainPendingMessage(workspaceId, sid))
          .catch((e) => console.error(`[SSE] pending drain failed ${tag} session=${sid}:`, e))
      }
    })

  return new Response(clientReadable, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ── Shared pieces for main-turn plugins ──

type InterceptContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call'
      call_id: string
      name: string
      arguments: string
      started_at?: number
      completed_at?: number
      parent_tool_use_id?: string | null
    }
  | {
      type: 'tool_result'
      call_id: string
      output: string
      is_error: boolean
      timestamp?: number
      parent_tool_use_id?: string | null
    }

/**
 * Mutable state shared by the persist and broadcast plugins for a single
 * main-agent turn. Persist owns writes to this state (sessionId on
 * `session.started`, sessionEndedSeen on `session.ended`); broadcast reads
 * it so it can make turn-level decisions (re-key, error-event synthesis)
 * without re-parsing events.
 */
export interface MainTurnSharedState {
  sessionId: string | null
  sessionEndedSeen: boolean
  /**
   * `reason` from the `session.ended` event, or null if the turn never
   * cleanly ended. Read by the after-turn pending-message drain, which only
   * fires for a `completed` turn.
   */
  endReason: NonNullable<UniversalEvent['reason']> | null
}

/**
 * Strictly serial task queue. Each `run(fn)` chains onto the previous
 * task. Used by both plugins so DB writes and deferred broadcast emits
 * observe a single happens-before order — the invariant that makes the
 * old "emit session.ended only after DB commits" behaviour preserved after
 * the split.
 */
export class SerialQueue {
  private chain: Promise<void> = Promise.resolve()

  run(task: () => Promise<void> | void, onError?: (e: unknown) => void): void {
    this.chain = this.chain
      .then(task)
      .catch(onError ?? ((e) => console.error('[SSE SerialQueue] task error:', e)))
  }

  async flush(): Promise<void> {
    await this.chain
  }
}

// ── Persist plugin ──

interface PersistPluginCtx {
  workspaceId: string
  userMessageText: string | null
  userImages?: Array<{ data: string; media_type: string }> | null
  callerUserId?: string
  source: string
  tag: string
  streamStartedAt: number
  state: MainTurnSharedState
  queue: SerialQueue
  /**
   * Session token minted by the dispatcher (executeChat / system-workspaces).
   * Bound to the SDK-generated session_id on `session.started` so the MCP
   * handler can reverse-resolve incoming tool calls to a session.
   */
  sessionToken?: string | null
  /**
   * Dispatcher hook fired exactly once, after the persist plugin has
   * created the sessions row for a brand-new session (so FKs to
   * `sessions(id)` are satisfied). Used by teamwork to register the new
   * coordinator session into `teamwork_sessions`, replacing the old
   * X-Task-Id header path. Errors are logged but not propagated.
   */
  onNewSession?: (sessionId: string) => Promise<void>
  /**
   * The auto-scaling replica this turn was routed to; persisted onto the
   * session row on `session.started` so subsequent turns pin to it. Undefined
   * for static workspaces (binding stays NULL).
   */
  replicaId?: number
  /**
   * Optional initial assistant-message state. Set on the recovery path
   * (CP restart) so the plugin resumes writing into the existing DB row
   * instead of creating a duplicate. When provided, new events are
   * appended to the pre-existing `blocks` / `content` snapshot and
   * `updateMessage` is used from the first persist call onward.
   */
  initialAssistant?: {
    id: string
    content: string
    blocks: InterceptContentPart[]
  }
}

function createPersistMainTurnPlugin(ctx: PersistPluginCtx): TurnPlugin {
  const {
    workspaceId,
    userMessageText,
    userImages,
    callerUserId,
    source,
    tag,
    streamStartedAt,
    state,
    queue,
  } = ctx

  let sessionStartedAt: number | null = null
  let firstResponseLogged = false

  // Seed from initialAssistant on the recovery path so events replayed
  // by the agent's buffered sink append to the existing DB row instead
  // of creating a second assistant message for the same turn.
  let textContent = ctx.initialAssistant?.content ?? ''
  let assistantMessageId: string | null = ctx.initialAssistant?.id ?? null
  let eventOrdinal = ctx.initialAssistant?.blocks.length ?? 0
  // Dedup tool_call by call_id across replays: on recovery we reuse the same
  // ordinal (and thus event id) so re-INSERT hits ON CONFLICT DO NOTHING.
  const toolCallOrdinal = new Map<string, number>()
  // Capture the tool_call start time from item.started so the persisted
  // tool_call carries `started_at`. Without it, the duration badge can only
  // be computed live during streaming and vanishes on reload.
  const toolCallStartedAt = new Map<string, number>()
  // Codex streams `tool_call_update`s for a single call as stdout accumulates;
  // we reuse one ordinal per call_id and upsert the row so the payload
  // overwrites in place instead of growing N rows.
  const toolResultOrdinal = new Map<string, number>()
  if (ctx.initialAssistant) {
    ctx.initialAssistant.blocks.forEach((b, i) => {
      if (b.type === 'tool_call' && b.call_id) {
        toolCallOrdinal.set(b.call_id, i)
        if (typeof b.started_at === 'number') toolCallStartedAt.set(b.call_id, b.started_at)
      }
      if (b.type === 'tool_result' && b.call_id) toolResultOrdinal.set(b.call_id, i)
    })
  }
  // Coalesce bursts of tool_result updates per call_id so the throttle bounds
  // DB write rate regardless of how fast the bridge fires events.
  const TOOL_RESULT_COALESCE_MS = 300
  interface PendingToolResult {
    ordinal: number
    payload: InterceptContentPart
    lastFlushedAt: number
    timer: ReturnType<typeof setTimeout> | null
  }
  const pendingToolResults = new Map<string, PendingToolResult>()
  let userMessageStored = false

  function logError(label: string) {
    return (e: unknown) =>
      console.error(`[SSE persist] ${label} ${tag} session=${state.sessionId}:`, e)
  }

  function enqueueEvent(kind: string, callId: string | null, payload: unknown, ordinal: number) {
    queue.run(
      async () => {
        if (!state.sessionId) return
        if (!assistantMessageId) {
          const msg = await addMessage(workspaceId, state.sessionId, 'assistant', textContent)
          assistantMessageId = msg.id
        }
        await insertEvent({
          messageId: assistantMessageId,
          sessionId: state.sessionId,
          ordinal,
          kind,
          callId,
          payload,
        })
        if (kind === 'text') {
          await updateMessageContent(assistantMessageId, textContent)
        }
      },
      logError(`event persist kind=${kind}`),
    )
  }

  function enqueueToolResultUpsert(callId: string, ordinal: number, payload: InterceptContentPart) {
    queue.run(async () => {
      if (!state.sessionId) return
      if (!assistantMessageId) {
        const msg = await addMessage(workspaceId, state.sessionId, 'assistant', textContent)
        assistantMessageId = msg.id
      }
      await upsertEvent({
        messageId: assistantMessageId,
        sessionId: state.sessionId,
        ordinal,
        kind: 'tool_result',
        callId,
        payload,
      })
    }, logError('event persist kind=tool_result'))
  }

  function scheduleToolResultFlush(callId: string) {
    const p = pendingToolResults.get(callId)
    if (!p || p.timer) return
    const elapsed = Date.now() - p.lastFlushedAt
    const delay = Math.max(0, TOOL_RESULT_COALESCE_MS - elapsed)
    p.timer = setTimeout(() => {
      const cur = pendingToolResults.get(callId)
      if (!cur) return
      cur.timer = null
      cur.lastFlushedAt = Date.now()
      enqueueToolResultUpsert(callId, cur.ordinal, cur.payload)
    }, delay)
  }

  function handleToolResult(callId: string, payload: InterceptContentPart) {
    let ord = toolResultOrdinal.get(callId)
    const isFirst = ord === undefined
    if (ord === undefined) {
      ord = eventOrdinal++
      toolResultOrdinal.set(callId, ord)
    }
    const existing = pendingToolResults.get(callId)
    if (existing) {
      existing.payload = payload
      scheduleToolResultFlush(callId)
      return
    }
    const entry: PendingToolResult = {
      ordinal: ord,
      payload,
      lastFlushedAt: 0,
      timer: null,
    }
    pendingToolResults.set(callId, entry)
    if (isFirst) {
      // Write the first payload immediately so UI replays / recovery see
      // the tool_result row without waiting for the coalesce window.
      entry.lastFlushedAt = Date.now()
      enqueueToolResultUpsert(callId, ord, payload)
      return
    }
    scheduleToolResultFlush(callId)
  }

  function flushPendingToolResults() {
    for (const [callId, entry] of pendingToolResults) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      enqueueToolResultUpsert(callId, entry.ordinal, entry.payload)
    }
    pendingToolResults.clear()
  }

  function enqueueUserMessage() {
    if (userMessageStored || !userMessageText) return
    userMessageStored = true
    const text = userMessageText
    const images = userImages
    queue.run(async () => {
      if (!state.sessionId) return
      console.log(`[SSE] Storing user message ${tag} session=${state.sessionId} len=${text.length}`)
      const userBlocks: Array<Record<string, unknown>> = [{ type: 'text', text }]
      if (images?.length) {
        for (const img of images) {
          userBlocks.push({
            type: 'image',
            data: img.data,
            media_type: img.media_type,
          })
        }
      }
      const msg = await addMessage(workspaceId, state.sessionId, 'user', text)
      await insertUserMessageBlocks(msg.id, state.sessionId, userBlocks)
    }, logError('user message persist'))
  }

  return {
    name: 'persist-main-turn',
    onEvent: (evt) => {
      switch (evt.type) {
        case 'session.started': {
          const newSid = evt.session_id
          if (typeof newSid !== 'string') break
          const isNew = state.sessionId !== newSid
          state.sessionId = newSid
          sessionStartedAt = Date.now()
          const initSec = ((sessionStartedAt - streamStartedAt) / 1000).toFixed(1)
          console.log(
            `[SSE] session.started ${tag} session=${newSid} isNew=${isNew} agentInit=${initSec}s`,
          )
          const token = ctx.sessionToken
          const onNewSession = ctx.onNewSession
          queue.run(async () => {
            if (isNew) {
              await createSession(workspaceId, newSid, '', callerUserId, source)
            } else {
              await updateSessionActivity(newSid)
            }
            await transitionSessionStatus(newSid, 'agent')
            // Pin the session to the replica this turn was routed to (auto-
            // scaling workspaces only). Written every turn: unchanged while
            // affinity holds, updated when the router rebound to a healthy
            // replica. Stays NULL for static workspaces (replicaId undefined).
            if (ctx.replicaId !== undefined) {
              await setSessionReplicaOrdinal(newSid, ctx.replicaId).catch((e) => {
                console.warn(`[SSE] setSessionReplicaOrdinal failed session=${newSid}:`, e)
              })
            }
            // Bind the dispatcher-minted token to this session_id once the
            // sessions row exists (FK target satisfied). Idempotent: a
            // reconnect that re-emits session.started for an already-bound
            // token is a no-op.
            if (token) {
              await bindSessionToken(token, newSid).catch((e) => {
                console.warn(`[SSE] bindSession failed token=${token} session=${newSid}:`, e)
              })
            }
            // Dispatcher hook for brand-new sessions only — teamwork uses
            // this to register the coordinator session row, which previously
            // depended on the UI's onSessionCreated callback racing the
            // first MCP tool call. With session_token reverse-resolving to
            // task via teamwork_sessions, this row must exist before any
            // tool call lands.
            if (isNew && onNewSession) {
              await onNewSession(newSid).catch((e) => {
                console.warn(`[SSE] onNewSession hook failed session=${newSid}:`, e)
              })
            }
          }, logError('session create/transition'))
          enqueueUserMessage()
          break
        }

        case 'session.ended': {
          state.sessionEndedSeen = true
          const durationSec = ((Date.now() - streamStartedAt) / 1000).toFixed(1)
          console.log(
            `[SSE] session.ended ${tag} session=${state.sessionId} reason=${(evt as UniversalEvent).reason} events=${eventOrdinal} duration=${durationSec}s`,
          )

          flushPendingToolResults()
          enqueueUserMessage()

          const stats = (evt as UniversalEvent).stats as TurnStats | undefined
          if (stats) {
            queue.run(async () => {
              if (!state.sessionId) return
              // Persist only the context gauge; token accounting is the ledger's job.
              await updateSessionStats(state.sessionId, {
                numTurns: stats.numTurns ?? 0,
                contextTokens: stats.contextTokens ?? 0,
                contextWindow: stats.contextWindow ?? 0,
              })
            }, logError('turn stats persist'))
          }

          // Fresh-data token-usage pull for this workspace. Detached (not on the
          // serial queue) so the 30s-timeout fetch never delays message
          // persistence; the periodic sweep is the completeness backstop, so a
          // failure here is harmless.
          void pullWorkspaceUsage(workspaceId).catch((e) =>
            console.warn(
              `[usage] session.ended pull ws=${workspaceId}:`,
              e instanceof Error ? e.message : e,
            ),
          )

          const reason = (evt as UniversalEvent).reason
          state.endReason = reason ?? null
          queue.run(async () => {
            if (!state.sessionId) return
            await transitionSessionStatus(state.sessionId, 'human')
            console.log(`[SSE] Stored assistant message ${tag} session=${state.sessionId}`)
            const summary =
              textContent.length > 200 ? `${textContent.slice(0, 200)}...` : textContent
            getWorkspace(workspaceId)
              .then((ws) => {
                if (!ws) return
                const body =
                  reason === 'error'
                    ? `Agent **${ws.name}** encountered an error.`
                    : summary
                      ? `Agent **${ws.name}** completed:\n\n${summary}`
                      : `Agent **${ws.name}** has completed its task.`
                const webBase = (process.env.WEB_PUBLIC_URL || '').replace(/\/$/, '')
                const url = webBase
                  ? `${webBase}/w/${workspaceId}${state.sessionId ? `?session=${encodeURIComponent(state.sessionId)}` : ''}`
                  : undefined
                notify({
                  eventType: 'agent.task_done',
                  payload: {
                    title: `Agent completed: ${ws.name}`,
                    body,
                    type: reason === 'error' ? 'failure' : 'success',
                    url,
                  },
                  targetUserIds: [ws.user_id],
                  scope: `ws:${workspaceId}`,
                })
              })
              .catch((e) => console.warn('[SSE] Failed to send task notification:', e))
          }, logError('final transition to human'))
          break
        }

        case 'item.started': {
          // Not persisted on its own; item.completed carries the final state and
          // DB is only read post-turn. UI still sees started events via the live
          // stream. We do, however, remember a tool_call's start time so the
          // tool_call row persisted at item.completed can carry `started_at`.
          const startedItem = evt.item
          if (startedItem?.kind === 'tool_call') {
            const tc = startedItem.content?.[0]
            if (tc?.type === 'tool_call' && tc.call_id) {
              toolCallStartedAt.set(tc.call_id, evt.timestamp ?? Date.now())
            }
          }
          break
        }

        case 'item.delta':
          // Streaming deltas are not persisted; item.completed carries the final text.
          break

        case 'item.completed': {
          const item = evt.item
          if (!item) break

          if (item.kind === 'message' && item.role === 'assistant') {
            let addedText = ''
            for (const part of item.content ?? []) {
              if (part.type === 'text' && typeof part.text === 'string') {
                addedText += part.text
              }
            }
            if (addedText) {
              textContent += addedText
              if (!firstResponseLogged && sessionStartedAt) {
                const ttfrSec = ((Date.now() - sessionStartedAt) / 1000).toFixed(1)
                console.log(
                  `[SSE] First response ${tag} session=${state.sessionId} ttfr=${ttfrSec}s`,
                )
                firstResponseLogged = true
              }
              enqueueUserMessage()
              enqueueEvent(
                'text',
                null,
                {
                  type: 'text',
                  text: addedText,
                } satisfies InterceptContentPart,
                eventOrdinal++,
              )
            }
          }

          if (item.kind === 'tool_call') {
            const tc = item.content?.[0]
            if (tc?.type === 'tool_call') {
              const callId = tc.call_id ?? ''
              let ord = toolCallOrdinal.get(callId)
              if (ord === undefined) {
                ord = eventOrdinal++
                toolCallOrdinal.set(callId, ord)
              }
              enqueueEvent(
                'tool_call',
                callId,
                {
                  type: 'tool_call',
                  call_id: callId,
                  name: tc.name ?? '',
                  arguments: tc.arguments || '{}',
                  ...(toolCallStartedAt.has(callId)
                    ? { started_at: toolCallStartedAt.get(callId) }
                    : {}),
                  completed_at: evt.timestamp ?? Date.now(),
                  ...(item.parent_tool_use_id
                    ? { parent_tool_use_id: item.parent_tool_use_id }
                    : {}),
                } satisfies InterceptContentPart,
                ord,
              )
            }
          }

          if (item.kind === 'tool_result') {
            const tr = item.content?.[0]
            if (tr?.type === 'tool_result' && tr.call_id) {
              const payload: InterceptContentPart = {
                type: 'tool_result',
                call_id: tr.call_id,
                output: truncateToolOutput(tr.output ?? ''),
                is_error: tr.is_error ?? false,
                timestamp: evt.timestamp ?? Date.now(),
                ...(item.parent_tool_use_id ? { parent_tool_use_id: item.parent_tool_use_id } : {}),
              }
              handleToolResult(tr.call_id, payload)
            }
          }
          break
        }

        case 'question.requested': {
          queue.run(async () => {
            if (state.sessionId) {
              await transitionSessionStatus(state.sessionId, 'human')
            }
          }, logError('transition to human (question)'))
          break
        }

        case 'error': {
          const errMsg = String(evt.message || 'unknown').slice(0, 200)
          console.error(`[SSE] Agent error ${tag} session=${state.sessionId}: ${errMsg}`)
          break
        }
      }
    },

    onEnd: async (_result) => {
      // Force-flush any coalesced tool_result so queue.flush below actually
      // waits for the final payload to commit (pending timers wouldn't).
      flushPendingToolResults()
      await queue.flush()
      if (!state.sessionEndedSeen && state.sessionId) {
        try {
          await transitionSessionStatus(state.sessionId, 'idle')
        } catch (e) {
          console.error(
            `[SSE persist] final transition to idle ${tag} session=${state.sessionId}:`,
            e,
          )
        }
      }
    },
  }
}

// ── Broadcast plugin ──

interface BroadcastPluginCtx {
  workspaceId: string
  existingSessionId: string | null
  tag: string
  streamStartedAt: number
  activeStream: ActiveSSEStream
  getActiveKey: () => string
  setActiveKey: (k: string) => void
  state: MainTurnSharedState
  queue: SerialQueue
}

export function createBroadcastPlugin(ctx: BroadcastPluginCtx): TurnPlugin {
  const {
    workspaceId,
    existingSessionId,
    tag,
    streamStartedAt,
    activeStream,
    getActiveKey,
    setActiveKey,
    state,
    queue,
  } = ctx

  function emitNow(rawData: string) {
    emitSSE(activeStream, `data: ${rawData}\n\n`)
  }

  function enqueueDeferredEmit(rawData: string) {
    queue.run(() => {
      emitSSE(activeStream, `data: ${rawData}\n\n`)
    })
  }

  return {
    name: 'broadcast',
    onEvent: (evt, rawData) => {
      switch (evt.type) {
        case 'session.started': {
          // The agent turn is now in progress — mirrors the DB transition
          // to chat_status='agent' and makes this stream count toward
          // `tos_sse_active_streams`.
          activeStream.turnActive = true
          const newSid = evt.session_id
          if (typeof newSid === 'string' && !existingSessionId) {
            const prevKey = getActiveKey()
            const nextKey = streamKey(workspaceId, newSid)
            if (prevKey !== nextKey) {
              activeStreams.delete(prevKey)
              activeStreams.set(nextKey, activeStream)
              setActiveKey(nextKey)
            }
          }
          emitNow(rawData)
          break
        }

        case 'session.ended':
        case 'question.requested':
          // Turn is over (or handed back to the human) — mirrors the DB
          // transition away from chat_status='agent'. The stream object
          // lingers until `runTurn` resolves, but it no longer counts as
          // an active turn.
          activeStream.turnActive = false
          // Defer: the persist plugin enqueued the state transition onto
          // the same queue right before we did, so this emit will run
          // after the DB reflects the new state.
          enqueueDeferredEmit(rawData)
          break

        default:
          // Any non-terminal agent event means the turn is producing
          // output — also re-arms `turnActive` when a turn resumes after a
          // `question.requested` handoff (no fresh `session.started` fires).
          activeStream.turnActive = true
          emitNow(rawData)
      }
    },

    onEnd: async (result) => {
      // Persist plugin's onEnd already flushed the queue; calling flush
      // again is a no-op unless persist re-enqueued after the flush.
      await queue.flush()

      if (!state.sessionEndedSeen) {
        const durationSec = ((Date.now() - streamStartedAt) / 1000).toFixed(1)
        if (isDraining()) {
          // This CP is shutting down (rolling deploy). The turn is still
          // alive on the agent — the next pod's `recoverOrphanedSessions`
          // will pick it up and the client's `runTurn` reconnects to the
          // recovered stream transparently. Emitting an `error` here would
          // misreport a successful handoff as a failure (the red "Agent
          // stream ended unexpectedly" toast). Close cleanly instead and let
          // reconnect/recovery own continuation.
          console.log(
            `[SSE] Handoff ${tag} session=${state.sessionId} duration=${durationSec}s — CP draining, skipping error emit, recovery will resume`,
          )
        } else {
          console.error(
            `[SSE] ${result.reason === 'timeout' ? 'Timeout' : 'Error'} ${tag} session=${state.sessionId} duration=${durationSec}s: ${result.error?.message ?? 'unknown'}`,
          )
          const errorPayload = JSON.stringify({
            type: 'error',
            message:
              result.reason === 'timeout'
                ? 'Agent stream timed out (model inference took too long)'
                : 'Agent stream ended unexpectedly',
          })
          emitSSE(activeStream, `data: ${errorPayload}\n\n`)
        }
      }

      // Mark done so the derived gauges stop counting this stream. Skipped
      // if a same-key replacement already cleaned us up.
      if (!activeStream.done) {
        activeStream.done = true
      }
      activeStream.turnActive = false
      if (activeStream.heartbeatTimer) {
        clearInterval(activeStream.heartbeatTimer)
        activeStream.heartbeatTimer = undefined
      }
      sseStreamDuration.observe((Date.now() - streamStartedAt) / 1000)
      for (const c of activeStream.controllers) {
        try {
          c.close()
        } catch {}
      }
      activeStream.controllers.clear()
      const originalKey = streamKey(workspaceId, existingSessionId)
      const currentKey = getActiveKey()
      activeStreams.delete(originalKey)
      if (currentKey !== originalKey) activeStreams.delete(currentKey)
      activeStream.doneResolve()

      const totalSec = ((Date.now() - streamStartedAt) / 1000).toFixed(1)
      console.log(`[SSE] Stream ended ${tag} session=${state.sessionId} duration=${totalSec}s`)
    },
  }
}
