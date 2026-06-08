import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  type McpServerConfig,
  type SDKMessage,
  type SDKUserMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  AskUserRequest,
  ChatImageAttachment,
  TurnStats,
} from '../../../internal/types/events.js'
import {
  CP_URL,
  WORKSPACE_DIR,
  WORKSPACE_ID,
  applyProviderEnv,
  getUserMcpServers,
  loadRuntimeConfig,
} from './config.js'
import { jinaServer } from './web-tools.js'

// SDK >=0.2.113 spawns a native binary from a per-platform optional dep.
// Auto-discovery in 0.2.116+ wrongly prefers the musl variant on Debian glibc
// (anthropics/claude-agent-sdk-typescript#296, #306), so we resolve the path
// ourselves and pin it via options.pathToClaudeCodeExecutable.
const claudeCodeExecutable: string | undefined = (() => {
  const platform = process.platform
  const arch = process.arch
  const variants: string[] = []
  if (platform === 'linux') {
    // Prefer glibc; fall back to musl. Both are static binaries and run on
    // either libc, so order only matters for finding *some* binary.
    variants.push(`linux-${arch}`, `linux-${arch}-musl`)
  } else if (platform === 'darwin' || platform === 'win32') {
    variants.push(`${platform}-${arch}`)
  }
  const req = createRequire(import.meta.url)
  for (const v of variants) {
    try {
      const pkgJson = req.resolve(`@anthropic-ai/claude-agent-sdk-${v}/package.json`)
      const binPath = pkgJson.replace(
        /package\.json$/,
        platform === 'win32' ? 'claude.exe' : 'claude',
      )
      if (existsSync(binPath)) return binPath
    } catch {}
  }
  return undefined
})()
if (claudeCodeExecutable) {
  console.log(`[chat] pathToClaudeCodeExecutable=${claudeCodeExecutable}`)
} else {
  console.warn('[chat] No native claude-agent-sdk variant found; relying on SDK auto-discovery')
}

// SDK 0.3.142 made MCP servers connect in the background so sessions start
// immediately; tools from those servers (e.g. our per-turn `tos-platform`) may
// not be ready on the very first turn. We inject `tos-platform` and user MCP
// servers and expect their tools available from message one, so restore the
// pre-0.3.142 blocking-connect behavior. Subprocess inherits process.env.
process.env.MCP_CONNECTION_NONBLOCKING ??= '0'

export type { AskUserRequest, TurnStats }

// Active abort controllers for interruption support
const activeControllers = new Map<string, AbortController>()

// Pending canUseTool responses for AskUserQuestion (keyed by requestId)
const pendingResponses = new Map<
  string,
  {
    resolve: (result: {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }) => void
    // The tool's original input (incl. `questions`). The SDK re-runs the
    // built-in AskUserQuestion with `updatedInput`, and that tool does
    // `questions.map(...)` — so we must preserve `questions`, not just send
    // back `{ answers }`, or it throws "undefined is not an object".
    originalInput: Record<string, unknown>
  }
>()
// Pending questions indexed by sessionId (for recovery after UI refresh)
const pendingQuestionsBySession = new Map<string, { requestId: string; questions: unknown[] }>()

export interface StreamCallbacks {
  onMessage: (message: SDKMessage) => void | Promise<void>
  onError: (error: Error) => void | Promise<void>
  onComplete: (stats?: TurnStats) => void | Promise<void>
  onAskUser?: (request: AskUserRequest) => void | Promise<void>
}

export interface ChatResult {
  sessionId: string
}

export function respondToQuestion(requestId: string, answers: Record<string, string>): boolean {
  const pending = pendingResponses.get(requestId)
  if (!pending) return false
  // Merge answers into the original input so the SDK gets the user's choices
  // while keeping `questions` intact for the re-run of the built-in tool.
  pending.resolve({ behavior: 'allow', updatedInput: { ...pending.originalInput, answers } })
  pendingResponses.delete(requestId)
  // Clean up session mapping
  for (const [sid, q] of pendingQuestionsBySession) {
    if (q.requestId === requestId) {
      pendingQuestionsBySession.delete(sid)
      break
    }
  }
  return true
}

export function getPendingQuestion(
  sessionId: string,
): { requestId: string; questions: unknown[] } | null {
  return pendingQuestionsBySession.get(sessionId) ?? null
}

export function interruptSession(sessionId: string): boolean {
  console.log(
    `[agent] interruptSession called session=${sessionId} active=${activeControllers.has(sessionId)}`,
  )
  const controller = activeControllers.get(sessionId)
  if (controller) {
    controller.abort()
    activeControllers.delete(sessionId)
    console.log(`[agent] interruptSession succeeded session=${sessionId}`)
    return true
  }
  console.log(`[agent] interruptSession not found session=${sessionId}`)
  return false
}

export async function chat(
  sessionId: string | undefined,
  userMessage: string,
  sessionToken: string | undefined,
  callbacks: StreamCallbacks,
  images?: ChatImageAttachment[],
): Promise<ChatResult> {
  const rc = loadRuntimeConfig()
  const model = rc?.model || process.env.ANTHROPIC_MODEL
  if (rc) {
    applyProviderEnv(rc)
  }
  if (!model) {
    console.warn('[chat] Warning: model not set, using SDK default')
  }
  const chatStartedAt = Date.now()
  console.log(
    `[chat] cwd: ${WORKSPACE_DIR}, model: ${model || '(default)'}, provider: ${rc?.provider_type || '(env)'}, resume: ${sessionId || '(new session)'}`,
  )

  let resultSessionId = sessionId || ''
  const abortController = new AbortController()

  // Register for interruption (use existing sessionId or a unique temporary key)
  const queryKey = sessionId || `pending-${crypto.randomUUID()}`
  activeControllers.set(queryKey, abortController)

  // Build prompt: plain string if no images, SDKUserMessage async generator if images
  let prompt: string | AsyncIterable<SDKUserMessage>
  if (images?.length) {
    const contentBlocks: Array<
      | {
          type: 'image'
          source: { type: 'base64'; media_type: string; data: string }
        }
      | { type: 'text'; text: string }
    > = []
    for (const img of images) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type, data: img.data },
      })
    }
    contentBlocks.push({ type: 'text', text: userMessage })
    const userMsg = {
      type: 'user' as const,
      message: { role: 'user' as const, content: contentBlocks },
      parent_tool_use_id: null,
      session_id: sessionId || '',
    }
    prompt = (async function* () {
      yield userMsg as SDKUserMessage
    })()
  } else {
    prompt = userMessage
  }

  // Build per-turn mcpServers. We own `tos-platform` here (instead of letting
  // cp's .mcp.json supply it) so the headers can vary by turn — specifically,
  // `X-Session-Token` carries the CP-minted proxy id for this turn's session.
  // Without it the platform MCP behaves identically to a non-session-aware
  // workspace-only chat. User-configured MCPs from `.mcp.json` are also merged
  // in here (overriding the SDK's settingSources='project' auto-load) so the
  // same token reaches third-party servers via cp's MCP proxy — the proxy
  // then translates it into `X-Tos-Session-Id` for upstream.
  const mcpServers: Record<string, McpServerConfig> = {
    exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' },
    'web-fetch': jinaServer,
  }
  for (const [name, cfg] of Object.entries(getUserMcpServers())) {
    if (cfg.url) {
      const headers = { ...(cfg.headers ?? {}) }
      if (sessionToken) headers['X-Session-Token'] = sessionToken
      mcpServers[name] = { type: 'http', url: cfg.url, headers }
    } else if (cfg.command) {
      mcpServers[name] = { type: 'stdio', command: cfg.command, args: cfg.args, env: cfg.env }
    }
  }
  if (CP_URL && WORKSPACE_ID) {
    // Merge user-configured headers (e.g. X-Builder set via the workspace MCP
    // editor) with the per-turn ones we own. User headers go in first so the
    // platform-controlled ones win on any name collision.
    const platformHeaders: Record<string, string> = {}
    try {
      const raw = readFileSync(join(WORKSPACE_DIR, '.mcp.json'), 'utf-8')
      const userHeaders = JSON.parse(raw)?.mcpServers?.['tos-platform']?.headers
      if (userHeaders && typeof userHeaders === 'object') {
        for (const [k, v] of Object.entries(userHeaders as Record<string, unknown>)) {
          if (typeof v === 'string') platformHeaders[k] = v
        }
      }
    } catch {
      // .mcp.json may not exist on first turn — fine, fall through to defaults
    }
    platformHeaders['X-Workspace-ID'] = WORKSPACE_ID
    platformHeaders['X-Agent-ID'] = WORKSPACE_ID
    if (sessionToken) platformHeaders['X-Session-Token'] = sessionToken
    mcpServers['tos-platform'] = {
      type: 'http',
      url: `${CP_URL}/mcp`,
      headers: platformHeaders,
    }
  }

  try {
    const messageStream = query({
      prompt,
      options: {
        model,
        pathToClaudeCodeExecutable: claudeCodeExecutable,
        permissionMode: 'default',
        disallowedTools: ['WebSearch', 'WebFetch'],
        mcpServers,
        maxTurns: 100,
        cwd: WORKSPACE_DIR,
        resume: sessionId,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project'],
        includePartialMessages: true,
        abortController,
        stderr: (data) => process.stderr.write(`[cc] ${data}`),
        canUseTool: async (toolName, input, { signal }) => {
          // Only intercept AskUserQuestion — auto-approve everything else
          if (toolName !== 'AskUserQuestion') {
            return { behavior: 'allow' as const, updatedInput: input }
          }

          const requestId = crypto.randomUUID()
          const questions = (input as Record<string, unknown>).questions as unknown[]
          callbacks.onAskUser?.({ requestId, questions })
          console.log(
            `[chat] AskUserQuestion requestId=${requestId} session=${resultSessionId} questions=${questions?.length}`,
          )

          // Store by session for recovery after UI refresh
          if (resultSessionId) {
            pendingQuestionsBySession.set(resultSessionId, {
              requestId,
              questions,
            })
          }

          return new Promise((resolve, reject) => {
            pendingResponses.set(requestId, {
              resolve,
              originalInput: input as Record<string, unknown>,
            })
            signal.addEventListener('abort', () => {
              pendingResponses.delete(requestId)
              if (resultSessionId) pendingQuestionsBySession.delete(resultSessionId)
              reject(signal.reason ?? new Error('aborted'))
            })
          })
        },
      },
    })

    const queryCreatedAt = Date.now()
    console.log(`[chat] Query started, sdk_init=${queryCreatedAt - chatStartedAt}ms`)

    let stats: TurnStats | undefined
    // Track the last assistant message's total context size (input + cache tokens)
    let lastContextTokens = 0

    let messageCount = 0
    let firstMessageAt: number | null = null
    let firstAssistantAt: number | null = null
    for await (const message of messageStream) {
      messageCount++
      if (!firstMessageAt) {
        firstMessageAt = Date.now()
        console.log(
          `[chat] First message received, query_startup=${firstMessageAt - queryCreatedAt}ms`,
        )
      }
      if (process.env.DEBUG_AGENT) {
        const sub = 'subtype' in message ? `/${(message as any).subtype}` : ''
        console.log(`[chat] msg#${messageCount} type=${message.type}${sub}`)
      }

      // Capture SDK session ID from first message
      if ('session_id' in message && message.session_id && !resultSessionId) {
        resultSessionId = message.session_id
        console.log(
          `[chat] Got SDK session ID: ${resultSessionId} session_init=${Date.now() - chatStartedAt}ms`,
        )
        // Update the controller key for interruption
        if (queryKey !== resultSessionId) {
          activeControllers.delete(queryKey)
          activeControllers.set(resultSessionId, abortController)
        }
      }

      // Track context size from stream events or assistant messages
      // Context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
      if (message.type === 'stream_event' && 'event' in message) {
        const event = (message as any).event
        const usage =
          event?.type === 'message_delta'
            ? event.usage
            : event?.type === 'message_start'
              ? event.message?.usage
              : undefined
        if (usage) {
          const total =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
          if (total > 0) lastContextTokens = total
        }
      }
      if (message.type === 'assistant' && 'message' in message) {
        const usage = (message as any).message?.usage
        if (usage) {
          const total =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
          if (total > 0) lastContextTokens = total
        }
      }

      // Track first assistant output
      if (!firstAssistantAt && message.type === 'assistant') {
        firstAssistantAt = Date.now()
        console.log(`[chat] First assistant output, ttfa=${firstAssistantAt - chatStartedAt}ms`)
      }

      // Extract stats from result message
      if (message.type === 'result') {
        const r = message as SDKMessage & {
          subtype?: string
          total_cost_usd?: number
          duration_ms?: number
          num_turns?: number
          result?: string
          errors?: string[]
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          modelUsage?: Record<string, { contextWindow?: number }>
          terminal_reason?: string
          stop_reason?: string | null
        }

        // Log result subtype and errors for debugging
        if (r.subtype && r.subtype !== 'success') {
          console.error(
            `[chat] Result subtype=${r.subtype} errors=${JSON.stringify((r as any).errors ?? [])}`,
          )
        }
        if (process.env.DEBUG_AGENT) {
          console.log(`[chat] Result message: ${JSON.stringify(r, null, 2)}`)
        }

        // Get context window from modelUsage (pick the largest)
        let contextWindow = 0
        try {
          if (r.modelUsage && typeof r.modelUsage === 'object') {
            for (const mu of Object.values(r.modelUsage)) {
              const cw = mu?.contextWindow
              if (typeof cw === 'number' && cw > contextWindow) {
                contextWindow = cw
              }
            }
          }
        } catch (e) {
          console.warn('[chat] Failed to extract modelUsage:', e)
        }
        stats = {
          costUsd: r.total_cost_usd ?? 0,
          durationMs: r.duration_ms ?? 0,
          numTurns: r.num_turns ?? 0,
          inputTokens: r.usage?.input_tokens ?? 0,
          outputTokens: r.usage?.output_tokens ?? 0,
          cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: r.usage?.cache_creation_input_tokens ?? 0,
          contextTokens:
            lastContextTokens ||
            (r.usage?.input_tokens ?? 0) +
              (r.usage?.cache_read_input_tokens ?? 0) +
              (r.usage?.cache_creation_input_tokens ?? 0),
          contextWindow,
        }
        console.log(
          `[chat] Result: turns=${stats.numTurns} cost=$${stats.costUsd.toFixed(4)} duration=${stats.durationMs}ms context=${stats.contextTokens}/${contextWindow} terminal_reason=${r.terminal_reason ?? 'unknown'} stop_reason=${r.stop_reason ?? 'unknown'}`,
        )
      }

      await callbacks.onMessage(message)

      if (message.type === 'result') {
        break
      }
    }

    console.log(`[chat] Query completed, total=${Date.now() - chatStartedAt}ms`)
    await callbacks.onComplete(stats)
  } catch (error) {
    // A user interrupt (interruptSession → controller.abort()) can surface in
    // two shapes: a DOMException-style `AbortError`, or — when the SDK's native
    // child process is killed mid-turn — a plain `Error` whose message is
    // "Claude Code process aborted by user" (minified class, name === 'Error').
    // The latter must NOT be treated as a failure: route both through
    // onComplete (reason 'interrupted') so server.ts emits session.ended and
    // the control-plane transitions the session out of the running state.
    if (
      abortController.signal.aborted ||
      (error instanceof Error &&
        (error.name === 'AbortError' || /aborted by user/i.test(error.message)))
    ) {
      console.log('[chat] Aborted')
      await callbacks.onComplete()
    } else {
      console.error('[chat] Error:', error)
      await callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
  } finally {
    activeControllers.delete(resultSessionId || queryKey)
  }

  return { sessionId: resultSessionId }
}

export type { SDKMessage }
