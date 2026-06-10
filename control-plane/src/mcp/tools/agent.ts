import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type TurnPlugin, runTurn } from '../../../../internal/sse-consumer/src'
import type { TurnStats } from '../../../../internal/types/events'
import {
  bindSession as bindSessionToken,
  ensureTokenForSession,
  mintToken,
} from '../../lib/session-token'
import {
  type MainTurnSharedState,
  SerialQueue,
  createBroadcastPlugin,
  isDraining,
  setupActiveStream,
} from '../../lib/sse'
import { truncateToolOutput } from '../../lib/truncate-tool-output'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import {
  addMessage,
  getLastAssistantMessage,
  insertEvent,
  insertUserMessageBlocks,
  updateMessageContent,
  upsertEvent,
} from '../../services/db/messages'
import {
  createSession,
  getSession,
  transitionSessionStatus,
  updateSessionActivity,
  updateSessionStats,
} from '../../services/db/sessions'
import { addTeamworkSession, resolveRosterMemberBySlug } from '../../services/db/teamwork'
import { getWorkspace, resolveWorkspaceBySlug } from '../../services/db/workspaces'
import { textResult } from './shared'

// Reset-on-every-event idle timeout. Sub-agent turns can legitimately run
// long (multi-minute tool calls), so we keep the same upper bound the legacy
// code used. It is now an *idle* ceiling, not a total one.
const AGENT_CALL_IDLE_TIMEOUT_MS = 60 * 60 * 1000

// Foreground calls that exceed this limit return a session_id for polling
// instead of blocking until completion. Keeps well under MCP client request
// timeouts (typically 60–120s) so the response always arrives in time.
const FOREGROUND_WAIT_MS = 30_000

interface SubAgentHandle {
  /** Resolves as soon as the sub-agent emits `session.started`. Rejects if the stream ends first. */
  sessionIdPromise: Promise<string>
  /** Resolves after the turn fully ends (success or error) with the persisted session id and final text. */
  resultPromise: Promise<{ sessionId: string | null; text: string }>
}

/**
 * Plugin that persists a sub-agent turn to the target workspace's DB.
 * Writes `sessionId` and `sessionEndedSeen` into the shared `state` so
 * the paired `broadcastPlugin` can re-key the activeStream and synthesize
 * the terminal error event without re-parsing events. All DB writes go
 * through the shared `SerialQueue` so `onEvent` stays synchronous.
 */
interface SubAgentPersistCtx {
  targetWorkspaceId: string
  /**
   * Workspace id of the calling agent (the `call_agent` invoker). Persisted on
   * the new sub-session so the session view can show "invoked by <agent>".
   * Null only if the caller workspace couldn't be resolved.
   */
  callerWorkspaceId?: string | null
  userPrompt: string
  state: MainTurnSharedState
  queue: SerialQueue
  onSessionStarted: (sessionId: string) => void
  /**
   * Fires after the sub-session row has been committed to `sessions`. Runs
   * inside the SerialQueue so it can safely insert into tables that FK to
   * `sessions(id)` — most notably `teamwork_sessions`, which would otherwise
   * race the createSession write and fail with FK violation. Errors are
   * logged through the same persistence error logger.
   */
  onSessionPersisted?: (sessionId: string) => Promise<void>
  onFinalized: (result: {
    reason: string
    error?: { message: string } | undefined
  }) => void
  getText: () => string
  appendText: (text: string) => void
  /**
   * Session token minted by `call_agent` and threaded to the sub-agent via
   * `/chat` body. Bound to the SDK-revealed sub-session id once the
   * sessions row exists so MCP requests from the sub-agent (e.g. nested
   * `call_agent`) carry a resolvable session identity.
   */
  sessionToken?: string | null
}

function createSubAgentPersistPlugin(ctx: SubAgentPersistCtx): TurnPlugin {
  const { targetWorkspaceId, userPrompt, state, queue, onSessionStarted, onFinalized } = ctx

  let assistantMessageId: string | null = null
  let eventOrdinal = 0
  const toolCallOrdinal = new Map<string, number>()
  const toolResultOrdinal = new Map<string, number>()
  let userMessageStored = false

  const TOOL_RESULT_COALESCE_MS = 300
  interface PendingToolResult {
    ordinal: number
    payload: Record<string, unknown>
    lastFlushedAt: number
    timer: ReturnType<typeof setTimeout> | null
  }
  const pendingToolResults = new Map<string, PendingToolResult>()

  function logError(label: string) {
    return (e: unknown) => console.error(`[call_agent] ${label} target=${targetWorkspaceId}:`, e)
  }

  async function ensureAssistantMessage(): Promise<string> {
    if (!assistantMessageId) {
      const msg = await addMessage(targetWorkspaceId, state.sessionId!, 'assistant', ctx.getText())
      assistantMessageId = msg.id
    }
    return assistantMessageId
  }

  function enqueueEvent(kind: string, callId: string | null, payload: unknown, ordinal: number) {
    queue.run(
      async () => {
        if (!state.sessionId) return
        const mid = await ensureAssistantMessage()
        await insertEvent({
          messageId: mid,
          sessionId: state.sessionId,
          ordinal,
          kind,
          callId,
          payload,
        })
        if (kind === 'text') {
          await updateMessageContent(mid, ctx.getText())
        }
      },
      logError(`event persist kind=${kind}`),
    )
  }

  function enqueueToolResultUpsert(
    callId: string,
    ordinal: number,
    payload: Record<string, unknown>,
  ) {
    queue.run(async () => {
      if (!state.sessionId) return
      const mid = await ensureAssistantMessage()
      await upsertEvent({
        messageId: mid,
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

  function handleToolResult(callId: string, payload: Record<string, unknown>) {
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
    if (userMessageStored) return
    userMessageStored = true
    queue.run(async () => {
      if (!state.sessionId) return
      const msg = await addMessage(targetWorkspaceId, state.sessionId, 'user', userPrompt)
      await insertUserMessageBlocks(msg.id, state.sessionId, [{ type: 'text', text: userPrompt }])
    }, logError('user message persist'))
  }

  return {
    name: 'call-agent-persist',
    onEvent: (evt) => {
      switch (evt.type) {
        case 'session.started': {
          const newSid = evt.session_id
          if (typeof newSid !== 'string') break
          const isNew = state.sessionId !== newSid
          state.sessionId = newSid
          console.log(`[call_agent] session.started target=${targetWorkspaceId} session=${newSid}`)
          // Resolve the external sessionIdPromise as soon as we know the id,
          // so background-mode callers don't wait on the DB round-trip.
          onSessionStarted(newSid)
          const token = ctx.sessionToken
          queue.run(async () => {
            if (isNew) {
              await createSession(
                targetWorkspaceId,
                newSid,
                '',
                undefined,
                'agent',
                ctx.callerWorkspaceId,
              )
            } else {
              await updateSessionActivity(newSid)
            }
            await transitionSessionStatus(newSid, 'agent')
            // Bind dispatcher-minted token (FK target satisfied above).
            if (token) {
              await bindSessionToken(token, newSid).catch((e) => {
                console.warn(
                  `[call_agent] bindSession failed target=${targetWorkspaceId} token=${token} session=${newSid}:`,
                  e,
                )
              })
            }
            // Now safe for FK-dependent followups (e.g. teamwork_sessions
            // INSERT) — the sessions row is committed.
            if (ctx.onSessionPersisted) {
              await ctx.onSessionPersisted(newSid)
            }
          }, logError('session create'))
          enqueueUserMessage()
          break
        }

        case 'session.ended': {
          state.sessionEndedSeen = true
          flushPendingToolResults()
          enqueueUserMessage()
          const stats = evt.stats as TurnStats | undefined
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
          break
        }

        case 'item.started':
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
              ctx.appendText(addedText)
              enqueueUserMessage()
              enqueueEvent('text', null, { type: 'text', text: addedText }, eventOrdinal++)
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
                  arguments: tc.arguments ?? '{}',
                },
                ord,
              )
            }
          }

          if (item.kind === 'tool_result') {
            const tr = item.content?.[0]
            if (tr?.type === 'tool_result' && tr.call_id) {
              handleToolResult(tr.call_id, {
                type: 'tool_result',
                call_id: tr.call_id,
                output: truncateToolOutput(tr.output ?? ''),
                is_error: tr.is_error ?? false,
              })
            }
          }
          break
        }

        case 'question.requested': {
          // The sub-agent is waiting on the user. Match legacy behaviour and
          // mark the session 'human' so another caller can pick it up.
          queue.run(async () => {
            if (state.sessionId) {
              await transitionSessionStatus(state.sessionId, 'human')
            }
          }, logError('transition to human (question)'))
          break
        }
      }
    },

    onEnd: async (result) => {
      flushPendingToolResults()
      await queue.flush()

      if (state.sessionId) {
        // Successful session.ended → 'human'; any other path → 'idle'.
        const terminalStatus = result.reason === 'completed' ? 'human' : 'idle'
        try {
          await transitionSessionStatus(state.sessionId, terminalStatus)
        } catch (e) {
          console.error(
            `[call_agent] final transition to ${terminalStatus} target=${targetWorkspaceId}:`,
            e,
          )
        }
      }

      onFinalized(result)
    },
  }
}

function runSubAgentTurn(
  response: Response,
  agentAddress: string,
  targetWorkspaceId: string,
  userPrompt: string,
  existingSessionId: string | null,
  onSessionPersisted?: (sessionId: string) => Promise<void>,
  sessionToken?: string | null,
  callerWorkspaceId?: string | null,
): SubAgentHandle {
  // Shared state + queue coordinate the persist and broadcast plugins.
  // Broadcast reads `state.sessionId` (for re-keying) and `sessionEndedSeen`
  // (for the terminal error event); persist writes both.
  const queue = new SerialQueue()
  // Pre-seed sessionId when continuing an existing session so the persist
  // plugin's `isNew` check routes to updateSessionActivity instead of trying
  // to createSession() on an existing PK.
  const state: MainTurnSharedState = {
    sessionId: existingSessionId,
    sessionEndedSeen: false,
    endReason: null,
  }

  // Register an activeStream for the target workspace so that a UI viewing
  // the sub-agent's session can attach via `/cp-reconnect` and watch the
  // turn unfold live. Without this, sub-agent turns were invisible to
  // anyone except the caller's resultPromise.
  const { activeStream, getActiveKey, setActiveKey } = setupActiveStream(
    targetWorkspaceId,
    existingSessionId,
    queue,
  )

  const streamStartedAt = Date.now()
  const tag = `call_agent target=${targetWorkspaceId}`

  // External handles given to the caller.
  let sessionIdResolved = false
  let resolveSid!: (id: string) => void
  let rejectSid!: (err: Error) => void
  const sessionIdPromise = new Promise<string>((res, rej) => {
    resolveSid = res
    rejectSid = rej
  })
  let textContent = ''

  const persistPlugin = createSubAgentPersistPlugin({
    targetWorkspaceId,
    callerWorkspaceId,
    userPrompt,
    state,
    queue,
    sessionToken,
    onSessionStarted: (sid) => {
      if (!sessionIdResolved) {
        sessionIdResolved = true
        resolveSid(sid)
      }
    },
    onSessionPersisted,
    onFinalized: (result) => {
      if (!sessionIdResolved) {
        sessionIdResolved = true
        rejectSid(
          new Error(result.error?.message ?? 'call_agent stream ended before session.started'),
        )
      }
    },
    appendText: (text) => {
      textContent += text
    },
    getText: () => textContent,
  })

  const broadcastPlugin = createBroadcastPlugin({
    workspaceId: targetWorkspaceId,
    existingSessionId,
    tag,
    streamStartedAt,
    activeStream,
    getActiveKey,
    setActiveKey,
    state,
    queue,
  })

  const resultPromise = runTurn(
    {
      stream: async () => response,
      // If the primary stream ends before `session.ended`, try once to pick
      // up the rest of the turn from the sub-agent's buffered sink via
      // `POST /sessions/:id/reconnect`. 404 → return null → runTurn falls
      // through to the error path cleanly. Reconnect events are dispatched
      // to the same persist + broadcast plugins, so the UI sees the turn
      // continue and the DB stays consistent.
      reconnect: async () => {
        // Same rationale as createInterceptedSSEResponse: during shutdown
        // the replacement CP pod owns recovery, so don't race it with a
        // dying reconnect from this process.
        if (isDraining()) {
          console.log(
            `[call_agent] Skip reconnect target=${targetWorkspaceId} — CP is shutting down`,
          )
          return null
        }
        const sid = state.sessionId
        if (!sid) return null
        try {
          const resp = await fetch(
            `${agentAddress}/sessions/${encodeURIComponent(sid)}/reconnect`,
            { method: 'POST' },
          )
          if (!resp.ok) return null
          return resp
        } catch (e) {
          console.error(
            `[call_agent] reconnect fetch failed target=${targetWorkspaceId} session=${sid}:`,
            e,
          )
          return null
        }
      },
      idleTimeoutMs: AGENT_CALL_IDLE_TIMEOUT_MS,
    },
    [persistPlugin, broadcastPlugin],
  ).then(() => ({ sessionId: state.sessionId, text: textContent }))

  return { sessionIdPromise, resultPromise }
}

export function registerAgentTools(server: McpServer, workspaceId: string, taskId: string | null) {
  // `taskId` (when set) was validated upstream in `handleMcpRequest` to belong
  // to a teamwork task that this workspace coordinates. call_agent uses it to
  // widen slug resolution to roster members (notably own-private workspaces
  // that the global visibility rules would reject).
  server.registerTool(
    'call_agent',
    {
      title: 'Call Another Agent',
      description: `Call another workspace agent by its slug and send it a prompt.
When the user mentions @agent/slug or @agent/user/slug, call this tool with the slug part (without the @agent/ prefix) and the rest as prompt.

Slug formats:
- "slug" — your own agent (visibility = user or public)
- "username/slug" — another user's public agent

Conversation modes (pick based on intent):
- New conversation (default, omit \`session_id\`): start a fresh session. Use this when the request is self-contained or unrelated to any previous dispatch — the sub-agent has no memory of prior calls.
- Continue conversation (pass \`session_id\` from a prior call_agent result): resume the existing sub-agent session so it sees its full history. Use this for follow-ups, clarifications, or iterative refinement on the same task ("now also do X", "you missed Y, redo with Z"). The \`session_id\` must belong to the *same target agent* you originally called and must still be active.

Result is always JSON with \`session_id\` (the sub-agent's session) and \`status\` (\`ended\`/\`running\`). On \`ended\`, also includes \`text\` (the sub-agent's reply). On \`running\` (background mode or foreground timeout), poll with get_agent_result. Save the returned \`session_id\` if you might want to continue the conversation later.

Examples:
- "@agent/reviewer check this code" → call_agent(slug="reviewer", prompt="check this code")
- Follow-up on the same review → call_agent(slug="reviewer", prompt="also flag any perf issues", session_id="<prior session_id>")
- "ask @agent/translator to translate: hello" → call_agent(slug="translator", prompt="translate: hello")
- "@agent/alice/formatter format this" → call_agent(slug="alice/formatter", prompt="format this")
- "@agent/pipeline run ETL in background" → call_agent(slug="pipeline", prompt="run ETL", mode="background")`,
      inputSchema: z.object({
        slug: z
          .string()
          .describe(
            'Target agent slug ("my-agent") or namespaced ("username/agent") for cross-user public agents',
          ),
        prompt: z.string().describe('The prompt/message to send to the target agent'),
        mode: z
          .enum(['foreground', 'background'])
          .default('foreground')
          .describe('foreground waits for result; background returns immediately with session_id'),
        session_id: z
          .string()
          .optional()
          .describe(
            'Optional. Provide a session_id returned by a prior call_agent invocation to continue that conversation (multi-turn). Omit to start a new session. Must belong to the same target agent (slug) and still be active.',
          ),
      }),
    },
    async ({ slug, prompt, mode, session_id }) => {
      try {
        const callerWorkspace = await getWorkspace(workspaceId)
        if (!callerWorkspace) {
          return textResult('Error: Caller workspace not found')
        }

        let target = await resolveWorkspaceBySlug(slug, callerWorkspace.user_id)
        // Teamwork fallback: when running in a task context, the caller can
        // also reach own-private roster members that the global visibility
        // rules just rejected. Cross-user public agents are already handled
        // by resolveWorkspaceBySlug above, so this path only widens reach
        // into the caller's own private workspaces explicitly added to the
        // task roster.
        if (!target && taskId) {
          target = await resolveRosterMemberBySlug(slug, callerWorkspace.user_id, taskId)
        }
        if (!target) {
          return textResult(`Error: No agent found with slug "${slug}" (check visibility settings)`)
        }

        if (target.id === workspaceId) {
          return textResult('Error: Cannot call yourself')
        }

        if (target.status !== 'running') {
          return textResult(`Error: Agent "${slug}" is not running`)
        }

        // Validate session_id when continuing an existing conversation.
        // Reject if it doesn't exist, belongs to a different agent, or is
        // no longer active — the sub-agent would otherwise either start a
        // brand-new session under the wrong id or persist into a foreign
        // workspace's history.
        if (session_id !== undefined) {
          const existing = await getSession(session_id)
          if (!existing) {
            return textResult(`Error: session_id "${session_id}" not found`)
          }
          if (existing.workspace_id !== target.id) {
            return textResult(
              `Error: session_id "${session_id}" does not belong to agent "${slug}"`,
            )
          }
          if (existing.status !== 'active') {
            return textResult(
              `Error: session_id "${session_id}" is not active (status=${existing.status})`,
            )
          }
        }

        const address = getWorkspaceAddress(target.id)

        // Mint or reuse a session_token scoped to the *sub-agent's* workspace.
        // The sub-agent threads this into its own MCP calls, so its tools
        // can reverse-resolve to the sub-session (independent of the caller's
        // session identity).
        const subSessionToken = session_id
          ? await ensureTokenForSession(target.id, session_id)
          : await mintToken({ workspaceId: target.id })

        const chatResp = await fetch(`${address}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            ...(session_id ? { session_id } : {}),
            session_token: subSessionToken,
          }),
        })

        if (!chatResp.ok) {
          return textResult(`Error: Agent "${slug}" returned status ${chatResp.status}`)
        }

        // Teamwork: tag the sub-session as a member of the caller's task so
        // the UI can list / open it without round-tripping through the
        // coord chat's tool_result JSON. Registration is enqueued inside
        // runSubAgentTurn's SerialQueue *after* createSession commits, so
        // the FK to sessions(id) is satisfied. parent_session_id stays
        // null for now (we don't carry caller session_id by design).
        const onSessionPersisted = taskId
          ? (sid: string) =>
              addTeamworkSession(taskId, sid, 'member', null).catch((e) => {
                console.error(
                  `[call_agent] Failed to register member session task=${taskId} slug=${slug}:`,
                  e,
                )
              })
          : undefined

        const handle = runSubAgentTurn(
          chatResp,
          address,
          target.id,
          prompt,
          session_id ?? null,
          onSessionPersisted,
          subSessionToken,
          callerWorkspace.id,
        )

        if (mode === 'background') {
          handle.resultPromise.catch((e) =>
            console.error(`[call_agent] Background stream error for slug=${slug}:`, e),
          )
          try {
            const sid = await Promise.race([
              handle.sessionIdPromise,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 10000),
              ),
            ])
            return textResult(JSON.stringify({ session_id: sid, status: 'running' }))
          } catch {
            return textResult(
              JSON.stringify({
                status: 'started',
                message: 'Agent call started but session ID not yet available.',
              }),
            )
          }
        }

        // Race the result against a timeout. If the sub-agent finishes within
        // FOREGROUND_WAIT_MS we return the result inline; otherwise we degrade
        // to the background pattern so the MCP client doesn't time out.
        const timeoutMarker = Symbol()
        const raceResult = await Promise.race([
          handle.resultPromise,
          new Promise<typeof timeoutMarker>((resolve) =>
            setTimeout(() => resolve(timeoutMarker), FOREGROUND_WAIT_MS),
          ),
        ])

        if (raceResult === timeoutMarker) {
          // Sub-agent is still running — return session_id for polling
          handle.resultPromise.catch((e) =>
            console.error(`[call_agent] Foreground-degraded stream error for slug=${slug}:`, e),
          )
          const sid = await handle.sessionIdPromise.catch(() => null)
          return textResult(
            JSON.stringify({
              status: 'running',
              session_id: sid,
              message: `Agent is still processing (>${FOREGROUND_WAIT_MS / 1000}s). Use get_agent_result with the session_id to retrieve the result.`,
            }),
          )
        }

        // Foreground completed. We always include the sub-agent's session_id
        // so observers (teamwork, debugging) can follow the dispatch tree.
        // The calling agent should read the `text` field for the agent's
        // reply; `session_id` is metadata.
        const completedSid = await handle.sessionIdPromise.catch(() => null)
        return textResult(
          JSON.stringify({
            session_id: completedSid,
            status: 'ended',
            text: raceResult.text || '(Agent returned no text response)',
          }),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'get_agent_result',
    {
      title: 'Get Agent Call Result',
      description: 'Get the result of a background agent call by session ID.',
      inputSchema: z.object({
        session_id: z
          .string()
          .describe('The session ID returned by a background call_agent invocation'),
      }),
    },
    async ({ session_id }) => {
      try {
        const message = await getLastAssistantMessage(session_id)
        if (!message) {
          return textResult(
            JSON.stringify({
              status: 'running',
              message: 'No result yet — agent may still be processing',
            }),
          )
        }
        return textResult(message.content)
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}
