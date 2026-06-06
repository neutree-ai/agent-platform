import type { Job, JobWithMetadata } from 'pg-boss'
import { type TurnPlugin, runTurn } from '../../internal/sse-consumer/src'
import * as db from './db'

const NAP_API_URL = process.env.NAP_API_URL || 'http://nap-cp:3000'
const CG_API_URL = process.env.CG_API_URL || 'http://nap-cg:3002'

function getChatEndpoint(workspaceId: string): string {
  return `${NAP_API_URL}/api/workspaces/${workspaceId}/chat`
}

/** CP-level SSE reconnect endpoint. The `session_id` query param scopes the
 *  reconnect to a single turn — a workspace can run several concurrently. */
function getCpReconnectEndpoint(workspaceId: string, sessionId: string): string {
  return `${NAP_API_URL}/_proxy/agent/${workspaceId}/cp-reconnect?session_id=${encodeURIComponent(sessionId)}`
}

// --- Types ---

export interface JobData {
  workspace_id: string
  prompt: string
  trigger: { type: string; payload?: unknown }
  service_token?: string
}

interface JobResult {
  session_id: string
  final_message?: string
  stats?: unknown
  error?: string
}

// --- Prompt Assembly ---

/** Assemble the final prompt from structured trigger payload fields.
 *  When resuming an existing session, thread_context is omitted to avoid duplication
 *  (the session already has prior messages in its history). */
function buildPrompt(opts: {
  message: string
  threadContext: string
  promptTemplate?: string | null
  templateVars?: Record<string, string>
}): string {
  const { message, threadContext, promptTemplate, templateVars } = opts
  if (!promptTemplate) {
    return threadContext + message
  }
  const hasCtxPlaceholder = promptTemplate.includes('{thread_context}')
  let result = promptTemplate
    .replace(/\{thread_context\}/g, threadContext)
    .replace(/\{message\}/g, message)
  if (templateVars) {
    for (const [k, v] of Object.entries(templateVars)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
    }
  }
  if (!hasCtxPlaceholder && threadContext) {
    result = threadContext + result
  }
  return result
}

// --- Main Handler ---

export async function handleJob(job: JobWithMetadata<JobData>): Promise<JobResult> {
  // Handle batch trigger: wrap execution with task status tracking
  if (job.data.trigger?.type === 'batch') {
    return handleBatchJob(job)
  }

  // Log queue wait time
  const createdAgo = job.createdOn ? Date.now() - new Date(job.createdOn).getTime() : null
  if (createdAgo != null) {
    console.log(
      `[Scheduler] Job=${job.id} picked up, queued ${(createdAgo / 1000).toFixed(1)}s ago`,
    )
  }

  // Per-workspace concurrency control: claim a slot before executing
  const wsId = job.data.workspace_id
  while (true) {
    const claimed = await db.tryClaimWsSlot(wsId, job.id)
    if (claimed) break
    console.log(`[Scheduler] Job=${job.id} waiting for ws=${wsId} concurrency slot`)
    await new Promise((r) => setTimeout(r, 3000))
  }

  const execStart = Date.now()
  try {
    const result = await executeJob(job)
    const execSec = ((Date.now() - execStart) / 1000).toFixed(1)
    console.log(`[Scheduler] Job=${job.id} finished in ${execSec}s session=${result.session_id}`)

    return result
  } finally {
    await db.releaseWsSlot(job.id)
  }
}

async function executeJob(job: Job<JobData>): Promise<JobResult> {
  // Resolve cron schedule: read latest config from DB
  if (job.data.trigger?.type === 'cron') {
    const scheduleId = (job.data.trigger.payload as Record<string, unknown>)?.schedule_id as string
    if (scheduleId) {
      const schedule = await db.getSchedule(scheduleId)
      if (!schedule || !schedule.enabled) {
        console.log(`[Scheduler] Skipping disabled/missing schedule=${scheduleId} job=${job.id}`)
        return { session_id: '', error: 'Schedule disabled or not found' }
      }
      const platformToken = await db.getPlatformToken(schedule.user_id)
      if (!platformToken) {
        console.error(
          `[Scheduler] No platform token for user=${schedule.user_id} schedule=${scheduleId}`,
        )
        return { session_id: '', error: 'No platform token for schedule owner' }
      }
      job.data.workspace_id = schedule.workspace_id
      job.data.prompt = schedule.prompt
      job.data.service_token = platformToken
      job.data.trigger.payload = { schedule_id: schedule.id, schedule_name: schedule.name }
      await db.updateScheduleLastRun(scheduleId)
      // One-time schedule fires exactly once. Mark completed before executing
      // so a run-now button click or pg-boss replay can't double-fire it.
      if (schedule.run_at) {
        await db.markScheduleCompleted(scheduleId)
      }
    }
  }

  const { workspace_id, prompt, trigger, service_token } = job.data
  console.log(
    `[Scheduler] Executing job=${job.id} workspace=${workspace_id} trigger=${trigger.type}`,
  )

  if (!service_token) throw new Error(`Job missing service_token: ${job.id}`)

  const chatEndpoint = getChatEndpoint(workspace_id)
  const authHeaders: Record<string, string> = { Authorization: `Bearer ${service_token}` }

  // Look up existing thread session for multi-turn conversations
  const triggerPayload = trigger.payload as Record<string, unknown> | undefined
  const routeId = triggerPayload?.route_id as string | undefined
  const replyContext = triggerPayload?.reply_context as Record<string, unknown> | undefined
  const threadId = replyContext?.thread_id as string | undefined

  const sessionTtlHours = (triggerPayload?.session_ttl_hours as number) || 24

  // Acquire per-thread advisory lock to prevent concurrent session resume on the same thread.
  // This ensures jobs for the same Slack thread execute serially.
  let threadLockClient: import('pg').PoolClient | null = null
  if (routeId && threadId) {
    threadLockClient = await db.acquireThreadLock(routeId, threadId)
    console.log(
      `[Scheduler] Acquired thread lock for route=${routeId} thread=${threadId} job=${job.id}`,
    )
  }

  try {
    let existingSessionId: string | null = null
    if (routeId && threadId) {
      const existing = await db.getThreadSession(routeId, threadId, sessionTtlHours)
      if (existing) {
        existingSessionId = existing.session_id
        console.log(
          `[Scheduler] Resuming session=${existingSessionId} for thread=${threadId} job=${job.id}`,
        )
      }
    }

    // Assemble final prompt from structured trigger payload fields.
    // Gateway already scopes thread_context correctly: full history for new sessions,
    // incremental (bystander messages only) for resumed sessions.
    const threadContext = (triggerPayload?.thread_context as string) || ''
    const promptTemplate = triggerPayload?.prompt_template as string | undefined
    const templateVars = triggerPayload?.template_vars as Record<string, string> | undefined
    const images = triggerPayload?.images as Array<{ data: string; media_type: string }> | undefined
    console.log(
      `[Scheduler] Job=${job.id} images=${images?.length ?? 0} (first_type=${images?.[0]?.media_type ?? '-'} first_data_len=${images?.[0]?.data?.length ?? 0})`,
    )
    const finalPrompt =
      threadContext || promptTemplate
        ? buildPrompt({ message: prompt, threadContext, promptTemplate, templateVars })
        : prompt

    // Build status callback for Slack triggers
    const statusCallback = trigger.type === 'slack' ? buildStatusCallback(trigger) : undefined

    // Build stream sink for connectors with reply_context.streaming === true (e.g. wecom)
    const streamSink = buildStreamSink(trigger)

    const source = trigger.type === 'cron' ? 'schedule' : trigger.type
    console.log(
      `[Scheduler] ${existingSessionId ? 'Continuing' : 'Starting new'} session job=${job.id}${streamSink ? ' (streaming)' : ''}`,
    )
    let sseResult = await startAndConsumeSession(
      chatEndpoint,
      workspace_id,
      finalPrompt,
      authHeaders,
      existingSessionId,
      statusCallback,
      source,
      images,
      streamSink,
    )

    // If resuming failed, fallback to a fresh session
    if (!sseResult && existingSessionId) {
      console.log(`[Scheduler] Session resume failed, creating new session for job=${job.id}`)
      sseResult = await startAndConsumeSession(
        chatEndpoint,
        workspace_id,
        finalPrompt,
        authHeaders,
        null,
        statusCallback,
        source,
        images,
        streamSink,
      )
    }

    if (!sseResult) throw new Error(`SSE stream failed for job=${job.id}`)

    // If we only got a session_id but the stream failed, treat as error
    if (!sseResult.final_message && sseResult.error) {
      throw new Error(sseResult.error)
    }

    console.log(`[Scheduler] Completed via SSE job=${job.id} session=${sseResult.session_id}`)

    // Reply to the source channel if triggered by a connector.
    // When streaming is used, the final frame has already been sent through the
    // stream sink — skip the non-streaming sendReply to avoid a duplicate bubble.
    if (trigger.type !== 'manual' && !streamSink) {
      if (sseResult.final_message) {
        await sendReply(trigger, sseResult.final_message)
      }
    }

    // Persist thread-to-session mapping AFTER sendReply so that last_active_at
    // is after the bot's Slack message. This ensures the incremental context
    // cursor skips the bot's own reply on the next turn.
    if (sseResult.session_id && routeId && threadId) {
      const channelId = replyContext?.channel_id as string | undefined
      await db.upsertThreadSession(routeId, threadId, sseResult.session_id, workspace_id, channelId)
    }

    return sseResult
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    console.error(`[Scheduler] Job=${job.id} failed: ${errorMsg}`)

    // Send error notification back to the source channel so users are not left waiting
    if (trigger.type !== 'manual') {
      await sendErrorReply(trigger, errorMsg)
    }

    throw e
  } finally {
    if (threadLockClient) {
      db.releaseThreadLock(threadLockClient)
      console.log(`[Scheduler] Released thread lock for job=${job.id}`)
    }
  }
}

// --- Batch Job Handler ---

async function handleBatchJob(job: Job<JobData>): Promise<JobResult> {
  const payload = job.data.trigger.payload as Record<string, unknown>
  const batchRunId = payload.batch_run_id as string
  const batchTaskId = payload.batch_task_id as string

  const { workspace_id, prompt, service_token } = job.data
  console.log(
    `[Scheduler] Batch task=${batchTaskId} run=${batchRunId} workspace=${workspace_id} job=${job.id}`,
  )

  // Atomically claim a concurrency slot, wait if at limit
  const concurrency = await db.getBatchRunConcurrency(batchRunId)
  while (true) {
    const claimed = await db.tryClaimBatchTask(batchTaskId, batchRunId, workspace_id, concurrency)
    if (claimed) break
    console.log(
      `[Scheduler] Batch task=${batchTaskId} waiting for concurrency slot (limit=${concurrency} for ws=${workspace_id})`,
    )
    await new Promise((r) => setTimeout(r, 3000))
  }

  let result: JobResult
  try {
    if (!service_token) throw new Error('Job missing service_token')

    const chatEndpoint = getChatEndpoint(workspace_id)
    const authHeaders = { Authorization: `Bearer ${service_token}` }

    const sseResult = await startAndConsumeSession(
      chatEndpoint,
      workspace_id,
      prompt,
      authHeaders,
      null,
      undefined,
      'batch',
    )
    if (!sseResult) throw new Error('SSE stream failed')

    result = sseResult

    // Mark task completed with session reference
    await db.updateBatchTask(batchTaskId, {
      status: 'completed',
      session_id: result.session_id,
    })
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    console.error(`[Scheduler] Batch task=${batchTaskId} failed:`, errorMsg)

    await db.updateBatchTask(batchTaskId, {
      status: 'failed',
      error: errorMsg,
    })

    result = { session_id: '', error: errorMsg }
  }

  // Check if all tasks in this batch run are done
  const { all_done, stats } = await db.checkBatchRunCompletion(batchRunId)
  if (all_done) {
    const finalStatus = stats.failed > 0 ? 'completed' : 'completed'
    await db.updateBatchRunStatus(batchRunId, finalStatus, stats)
    console.log(
      `[Scheduler] Batch run=${batchRunId} completed: ${stats.completed}/${stats.total} succeeded`,
    )
  }

  return result
}

// --- Reply ---

interface StreamSink {
  push(delta: string): Promise<void>
  finish(): Promise<void>
}

/** Build a streaming sink for connectors with reply_context.streaming === true.
 *  Sends *cumulative* content snapshots (not deltas) and chains pushes so cg
 *  always sees them in order — fire-and-forget concurrent POSTs would otherwise
 *  let cg observe deltas in arrival order, scrambling characters in WeCom UI. */
function buildStreamSink(trigger: JobData['trigger']): StreamSink | null {
  const payload = trigger.payload as Record<string, unknown> | undefined
  const replyContext = payload?.reply_context as Record<string, unknown> | undefined
  if (!replyContext?.streaming) return null
  const connectorId = payload?.connector_id as string | undefined
  const routeId = payload?.route_id as string | undefined
  if (!connectorId || !routeId) return null

  const url = `${CG_API_URL}/internal/connectors/${connectorId}/send`
  let pendingFull = ''
  let chain: Promise<void> = Promise.resolve()
  let finished = false

  const post = async (stream: { content: string; finish: boolean }) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId, reply_to: replyContext, stream }),
    })
    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      throw new Error(`cg stream send ${resp.status}: ${err}`)
    }
  }

  return {
    async push(delta: string) {
      if (finished || !delta) return
      pendingFull += delta
      const snapshot = pendingFull
      chain = chain.then(async () => {
        if (finished) return
        try {
          await post({ content: snapshot, finish: false })
        } catch (e) {
          console.warn('[Scheduler] stream push failed:', e instanceof Error ? e.message : e)
        }
      })
    },
    async finish() {
      if (finished) return
      finished = true
      await chain.catch(() => {})
      try {
        await post({ content: pendingFull, finish: true })
      } catch (e) {
        console.warn('[Scheduler] stream finish failed:', e instanceof Error ? e.message : e)
      }
    },
  }
}

async function sendReply(trigger: JobData['trigger'], text: string) {
  const payload = trigger.payload as Record<string, unknown> | undefined
  if (!payload?.connector_id || !payload?.route_id) return

  const resp = await fetch(`${CG_API_URL}/internal/connectors/${payload.connector_id}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route_id: payload.route_id,
      reply_to: payload.reply_context,
      text,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    console.error(`[Scheduler] Failed to send reply: ${resp.status} ${err}`)
  } else {
    console.log(`[Scheduler] Reply sent via connector=${payload.connector_id}`)
  }
}

function isTransientFetchError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes('socket connection was closed') ||
    msg.includes('other side closed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('UND_ERR_SOCKET') ||
    msg.includes('fetch failed')
  )
}

async function sendErrorReply(trigger: JobData['trigger'], errorMsg: string) {
  const text = isTransientFetchError(errorMsg)
    ? 'The service was briefly unavailable. Please try again; contact an admin if this persists.'
    : `Job failed: ${errorMsg}`
  try {
    await sendReply(trigger, text)
  } catch (e) {
    console.error('[Scheduler] Failed to send error reply:', e)
  }
}

// --- Status Callback ---

type StatusCallback = (status: string) => void

function buildStatusCallback(trigger: JobData['trigger']): StatusCallback {
  const payload = trigger.payload as Record<string, unknown> | undefined
  const connectorId = payload?.connector_id as string | undefined
  const replyContext = payload?.reply_context as Record<string, unknown> | undefined
  const threadTs = replyContext?.thread_ts as string | undefined
  const channelId = replyContext?.channel_id as string | undefined

  if (!connectorId || !channelId || !threadTs) return () => {}

  return (status: string) => {
    fetch(`${CG_API_URL}/internal/connectors/${connectorId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, thread_ts: threadTs, status }),
    }).catch((e) => console.warn('[Scheduler] Failed to set status:', e))
  }
}

// --- Session Management ---

async function startAndConsumeSession(
  chatEndpoint: string,
  workspaceId: string,
  prompt: string,
  headers: Record<string, string>,
  sessionId?: string | null,
  onStatus?: StatusCallback,
  source?: string,
  images?: Array<{ data: string; media_type: string }>,
  streamSink?: StreamSink | null,
): Promise<JobResult | null> {
  const body = JSON.stringify({
    message: prompt,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(source ? { source } : {}),
    ...(images?.length ? { images } : {}),
  })
  console.log(
    `[Scheduler] POST /chat workspace=${workspaceId} session=${sessionId ?? '(new)'} source=${source ?? '-'} images=${images?.length ?? 0} body_bytes=${body.length}`,
  )

  // Retry only the initial POST — once the SSE stream starts we can't replay safely.
  const maxAttempts = 3
  let response: Response | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      })
      break
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientFetchError(e)) throw e
      const backoffMs = 500 * 2 ** (attempt - 1)
      console.warn(
        `[Scheduler] Transient fetch error on /chat, retry ${attempt}/${maxAttempts - 1} in ${backoffMs}ms: ${e instanceof Error ? e.message : String(e)}`,
      )
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  if (!response) throw new Error('Failed to reach agent after retries')

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Agent returned ${response.status}: ${text}`)
  }

  // Consume the SSE stream via the shared runTurn consumer. Its event-level
  // idle timeout is the backstop for cp-side SSE hangs: cp keeps the TCP
  // connection warm with 15s heartbeat comment frames even when the agent is
  // stuck, so only a "no UniversalEvent for SSE_IDLE_TIMEOUT_MS" signal can
  // detect the hang. runTurn never throws — on timeout it resolves with
  // reason='timeout', which we surface as a failed job below so handler's
  // finally releases the advisory lock and ws slot.
  //
  // The `reconnect` source covers the other failure mode: the scheduler↔cp
  // SSE stream breaking mid-turn (typically a cp rollout restart). When the
  // primary stream ends before `session.ended`, runTurn re-attaches via cp's
  // `/cp-reconnect`; paired with the replacement cp's recoverOrphanedSessions
  // re-attaching cp→agent, a single cp restart stays transparent to the turn.
  const { plugin, sink } = createSchedulerPlugin(workspaceId, onStatus, streamSink)
  const captured = response
  const result = await runTurn(
    {
      stream: async () => captured,
      reconnect: buildCpReconnectSource(workspaceId, headers, sink),
      idleTimeoutMs: SSE_IDLE_TIMEOUT_MS,
    },
    [plugin],
  )

  const finalSessionId = result.sessionId ?? sink.sessionId

  if (result.reason === 'completed') {
    return {
      session_id: finalSessionId ?? '',
      final_message: sink.textContent,
      stats: result.stats,
      error: sink.lastError,
    }
  }

  // Non-completed (timeout / error / aborted / interrupted): return a partial
  // result with session_id only — no final_message, so the caller throws and
  // runs its finally. With no session at all, return null so a failed resume
  // falls through to the fresh-session retry.
  const errMsg = result.error?.message ?? 'SSE stream failed'
  console.warn(
    `[Scheduler] SSE turn ended reason=${result.reason} workspace=${workspaceId} session=${finalSessionId ?? '-'}: ${errMsg}`,
  )
  if (finalSessionId) {
    return { session_id: finalSessionId, error: errMsg }
  }
  return null
}

// --- SSE Stream Consumer ---

/** Idle timeout for the cp /chat SSE stream, in ms. The stream counts as
 *  hung when no UniversalEvent arrives within this window. cp's 15s heartbeat
 *  comment frames are NOT events, so runTurn's event-level idle timer still
 *  fires on a stuck agent even though the TCP connection stays warm.
 *  Overridable via env; defaults to runTurn's own 30-minute default. */
const SSE_IDLE_TIMEOUT_MS = Number(process.env.SCHEDULER_SSE_IDLE_TIMEOUT_MS) || 30 * 60 * 1000

/** Total budget for the scheduler↔cp reconnect retry loop, in ms. A cp
 *  rollout restart (SIGTERM → replacement pod scheduled → ready →
 *  recoverOrphanedSessions re-attaches cp→agent) must finish inside this
 *  window for the reconnect to land. Overridable via env; defaults to 3
 *  minutes. Keep it well below SSE_IDLE_TIMEOUT_MS: runTurn's idle timer
 *  keeps counting across the reconnect loop, so a budget near the idle
 *  timeout risks an idle abort firing mid-retry. */
const CP_RECONNECT_BUDGET_MS = Number(process.env.SCHEDULER_CP_RECONNECT_BUDGET_MS) || 3 * 60 * 1000

/** Exponential backoff bounds for the reconnect retry loop, in ms. */
const CP_RECONNECT_BACKOFF_MIN_MS = 2_000
const CP_RECONNECT_BACKOFF_MAX_MS = 15_000

interface SchedulerSink {
  sessionId: string | null
  textContent: string
  lastError?: string
}

/**
 * Build a reconnect source for `runTurn` that re-attaches the scheduler to an
 * in-flight cp turn after the scheduler↔cp SSE stream breaks mid-turn — the
 * usual cause being a cp rollout restart killing the pod that was relaying it.
 *
 * `runTurn` invokes this at most once, only when the primary stream ended
 * before `session.ended`. We poll cp's `/_proxy/agent/:wid/cp-reconnect` with
 * backoff: while the old cp is gone and the replacement pod is still booting
 * — or has booted but `recoverOrphanedSessions` hasn't re-attached cp→agent
 * yet — the endpoint is unreachable or answers 404. Once recovery has
 * re-registered the active stream, it returns a live SSE response carrying
 * the rest of the turn, and the agent finishes the turn transparently.
 *
 * Returns `null` (so `runTurn` falls through to the error path) when:
 *  - no `session.started` was ever seen — the turn never got far enough for
 *    cp's recovery to have anything to re-attach to;
 *  - an `error` event already arrived — cp emits a synthetic error frame only
 *    when it has itself given up on the turn, so reconnecting is pointless;
 *  - the budget is exhausted before the replacement cp is reachable.
 */
function buildCpReconnectSource(
  workspaceId: string,
  headers: Record<string, string>,
  sink: SchedulerSink,
): () => Promise<Response | null> {
  return async () => {
    if (!sink.sessionId) {
      console.warn(`[Scheduler] cp-reconnect skipped workspace=${workspaceId}: no session seen`)
      return null
    }
    if (sink.lastError) {
      console.warn(
        `[Scheduler] cp-reconnect skipped workspace=${workspaceId} session=${sink.sessionId}: cp already reported error`,
      )
      return null
    }

    const sessionId = sink.sessionId
    const url = getCpReconnectEndpoint(workspaceId, sessionId)
    const deadline = Date.now() + CP_RECONNECT_BUDGET_MS
    let attempt = 0
    while (Date.now() < deadline) {
      attempt++
      try {
        const resp = await fetch(url, { method: 'POST', headers })
        if (resp.ok && resp.headers.get('Content-Type')?.includes('text/event-stream')) {
          console.log(
            `[Scheduler] cp-reconnect attached workspace=${workspaceId} session=${sessionId} attempt=${attempt}`,
          )
          return resp
        }
        // 404 = replacement cp not ready, or recovery hasn't re-registered
        // the active stream yet. Discard the body to release the socket, retry.
        await resp.body?.cancel().catch(() => {})
        console.log(
          `[Scheduler] cp-reconnect not ready workspace=${workspaceId} attempt=${attempt} status=${resp.status}`,
        )
      } catch (e) {
        // cp pod still down / connection refused — expected mid-restart.
        console.log(
          `[Scheduler] cp-reconnect unreachable workspace=${workspaceId} attempt=${attempt}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      const backoff = Math.min(
        CP_RECONNECT_BACKOFF_MAX_MS,
        CP_RECONNECT_BACKOFF_MIN_MS * 2 ** (attempt - 1),
      )
      if (Date.now() + backoff >= deadline) break
      await new Promise((r) => setTimeout(r, backoff))
    }
    console.warn(
      `[Scheduler] cp-reconnect gave up workspace=${workspaceId} session=${sessionId} after ${attempt} attempt(s)`,
    )
    return null
  }
}

/** Build a runTurn plugin that harvests the job-result fields from the event
 *  stream and drives the connector status / streaming callbacks. CP's proxy
 *  interceptor owns all DB persistence — scheduler only consumes the stream
 *  to keep it flowing and to extract session_id and the final assistant text. */
function createSchedulerPlugin(
  workspaceId: string,
  onStatus?: StatusCallback,
  streamSink?: StreamSink | null,
): { plugin: TurnPlugin; sink: SchedulerSink } {
  const sink: SchedulerSink = { sessionId: null, textContent: '' }

  const plugin: TurnPlugin = {
    name: 'scheduler-sink',
    onEvent: (evt) => {
      switch (evt.type) {
        case 'session.started':
          if (evt.session_id) sink.sessionId = evt.session_id
          onStatus?.('is thinking...')
          break

        case 'item.delta':
          if (streamSink && evt.delta?.type === 'text' && evt.delta.text) {
            // Fire-and-forget: push() chains internally so out-of-order
            // arrival can't scramble the cumulative snapshot it sends.
            void streamSink.push(evt.delta.text)
          }
          break

        case 'item.started':
          if (evt.item?.kind === 'tool_call') {
            const toolName = evt.item.content?.[0]?.name || 'a tool'
            onStatus?.(`is calling ${toolName}...`)
          }
          break

        case 'item.completed': {
          const item = evt.item
          if (item?.kind === 'message' && item.role === 'assistant') {
            // Last assistant message wins. Codex emits intermediate "commentary"
            // narration as separate assistant message items between tool_calls
            // (upstream marks them phase=Commentary; codex-acp drops the field).
            // The final message of a turn is reliably the answer to deliver.
            let messageText = ''
            for (const part of item.content || []) {
              if (part.type === 'text' && part.text) messageText += part.text
            }
            if (messageText) sink.textContent = messageText
          }
          if (item?.kind === 'tool_call') {
            onStatus?.('is thinking...')
          }
          break
        }

        case 'question.requested':
          onStatus?.('is waiting for human input...')
          break

        case 'error':
          sink.lastError = evt.message || 'Unknown agent error'
          onStatus?.('encountered an error')
          console.error(`[Scheduler] Agent error workspace=${workspaceId}: ${sink.lastError}`)
          break
      }
    },
    onEnd: async () => {
      // runTurn calls onEnd exactly once on every exit path (completed,
      // timeout, error), so this is the single place the wecom stream sink
      // gets its terminal frame — it can never be left unfinished.
      await streamSink?.finish()
    },
  }

  return { plugin, sink }
}
