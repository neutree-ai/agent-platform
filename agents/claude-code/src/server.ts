import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createNodeWebSocket } from '@hono/node-ws'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { streamSSE } from 'hono/streaming'
import WebSocket from 'ws'
import { registerSkillRoutes } from '../../../internal/agent-skills/src/routes.js'
import { registerUsageRoutes } from '../../../internal/agent-usage/src/routes.js'
import { chat, getPendingQuestion, interruptSession, respondToQuestion } from './agent.js'
import {
  WORKSPACE_DIR,
  getSkillManager,
  loadConfig,
  loadCredentials,
  loadRuntimeConfig,
  loadSkills,
} from './config.js'
import type { ChatRequest } from './types.js'
import { UniversalEventTranslator } from './universal-events.js'

export const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
export { injectWebSocket }

// Middleware — skip logging for health checks
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next()
  const log = logger()
  return log(c, next)
})
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'MKCOL', 'MOVE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Destination'],
  }),
)

// Skill management routes
registerSkillRoutes(app, '/skills', getSkillManager)

// Token-usage pull endpoint — cp pulls per-turn token records read from the
// on-disk transcripts. The reader scans BOTH .claude and .codex (a workspace
// switched between cores keeps the other core's transcripts on its PVC), so
// every agent passes its workspace model as the fallback for records that omit
// one (codex rollouts do). See internal/agent-usage.
registerUsageRoutes(app, '/usage', {
  homeDir: process.env.HOME ?? join(WORKSPACE_DIR, '.home'),
  fallbackModel: () => loadRuntimeConfig()?.model,
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Info — AgentInfo contract
app.get('/info', (c) => {
  let runtime: { model?: string; provider_type?: string } = {}
  try {
    runtime = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'runtime.json'), 'utf-8'))
  } catch {}
  return c.json({
    agent_type: 'claude-code',
    model: runtime.model || process.env.ANTHROPIC_MODEL || 'default',
    capabilities: {
      system_prompt: true,
      mcp: true,
      skills: true,
      questions: true,
      reconnect: true,
      permissions: false,
      streaming_deltas: true,
    },
  })
})

// ── Session sink: replaceable SSE writer that survives UI refresh during ASQ ──

interface SessionSink {
  write: (event: string, data: string) => Promise<void>
  buffer: Array<{ event: string; data: string }>
  disconnected: boolean
  doneResolve: () => void
  donePromise: Promise<void>
}

const activeSinks = new Map<string, SessionSink>()

function switchToBufferMode(sessionId: string, expectedWriter?: SessionSink['write']) {
  const sink = activeSinks.get(sessionId)
  if (!sink) return
  // If the caller owned a specific writer but something has since replaced
  // `sink.write` (e.g. a `/reconnect` handler took over), leave the new
  // handler in charge. Stomping here is exactly the bug that used to kill
  // recovery reconnects when the original /chat TCP disconnected late.
  if (expectedWriter !== undefined && sink.write !== expectedWriter) {
    console.log(
      `[agent] Skipping switchToBufferMode session=${sessionId} (writer replaced by another handler)`,
    )
    return
  }
  console.log(`[agent] Switching session=${sessionId} to buffer mode`)
  sink.disconnected = true
  sink.write = async (event, data) => {
    sink.buffer.push({ event, data })
  }
}

// Chat - SSE streaming endpoint
// session_id is optional: omit for new session, provide for multi-turn conversation
app.post('/chat', async (c) => {
  const body = await c.req.json<ChatRequest>()
  const { message, session_id: sessionId, images, session_token: sessionToken } = body

  if (!message) {
    return c.json({ error: 'Message is required' }, 400)
  }

  // Track current session ID for interruption
  let currentSessionId = sessionId

  return streamSSE(c, async (stream) => {
    // Create session sink with SSE writer
    let doneResolve!: () => void
    const donePromise = new Promise<void>((r) => {
      doneResolve = r
    })
    // Capture a stable reference to this handler's writer so the abort
    // listener below can tell whether a later `/reconnect` has replaced
    // `sink.write`.
    let lastWriteAt = Date.now()
    const chatWriter: SessionSink['write'] = async (event, data) => {
      try {
        lastWriteAt = Date.now()
        await stream.writeSSE({ event, data })
      } catch {
        // Stream closed (client disconnected or aborted) — silently drop
      }
    }
    const sink: SessionSink = {
      write: chatWriter,
      buffer: [],
      disconnected: false,
      doneResolve,
      donePromise,
    }

    // Register sink immediately if we have a sessionId
    if (sessionId) {
      activeSinks.set(sessionId, sink)
    }

    // SSE comment-line heartbeat. Long sub-agent / parallel-tool runs can
    // leave the writer idle for many minutes, and ~5min of TCP idle reliably
    // gets the cp↔agent stream killed by some intermediate (Node http,
    // kube-proxy/conntrack, undici recycle), surfacing as `terminated` on cp
    // and "Agent stream ended unexpectedly" to the user even though the agent
    // keeps running. Writing a `:` comment frame every KEEPALIVE_MS of
    // writer-idle keeps it warm; readSSE ignores comment lines per the SSE
    // spec, so cp sees nothing new. (Mirrors acp-adapter/acp-server.ts.)
    const KEEPALIVE_MS = 15_000
    const keepaliveTimer = setInterval(() => {
      if (sink.disconnected) return
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return
      stream.write(':\n\n').catch(() => {})
      lastWriteAt = Date.now()
    }, KEEPALIVE_MS)

    // Handle client disconnect — always buffer, never interrupt.
    // The agent loop continues running; a reconnect or new CP pod can
    // pick up buffered events.  Interrupting mid-loop wastes work and
    // leaves the session in an inconsistent state.
    // If a /reconnect handler has taken over sink.write, don't stomp it:
    // only switch to buffer mode when we still own the writer.
    c.req.raw.signal.addEventListener('abort', () => {
      console.log(
        `[agent] Client disconnected session=${currentSessionId ?? 'null'}, switching to buffer mode`,
      )
      if (currentSessionId) {
        switchToBufferMode(currentSessionId, chatWriter)
      }
      clearInterval(keepaliveTimer)
    })

    const translator = new UniversalEventTranslator(sessionId)

    // For resume, emit session.started immediately so downstream (scheduler) always gets the session ID
    if (sessionId) {
      const evt = translator.sessionStarted(sessionId)
      await sink.write('message', JSON.stringify(evt))
    }

    await chat(
      sessionId,
      message,
      sessionToken,
      {
        onMessage: async (msg) => {
          // Send session.started as soon as we get the session ID (new session only)
          if ('session_id' in msg && msg.session_id && !currentSessionId) {
            currentSessionId = msg.session_id
            // Register sink under the real session ID
            if (!sessionId) {
              activeSinks.set(currentSessionId, sink)
            }
            const evt = translator.sessionStarted(currentSessionId)
            await sink.write('message', JSON.stringify(evt))
          }

          // Translate SDK message to UniversalEvent(s)
          const events = translator.translate(msg)
          for (const evt of events) {
            await sink.write('message', JSON.stringify(evt))
          }
        },
        onAskUser: async (request) => {
          const evt = translator.questionRequested(request)
          await sink.write('message', JSON.stringify(evt))
        },
        onError: async (error) => {
          const evt = translator.error(error.message)
          await sink.write('message', JSON.stringify(evt))
        },
        onComplete: async (stats) => {
          const reason = stats ? 'completed' : 'interrupted'
          const evt = translator.sessionEnded(reason, stats)
          await sink.write('message', JSON.stringify(evt))
          if (currentSessionId) {
            if (sink.disconnected) {
              // CP disconnected — keep sink alive for reconnect to flush buffered events
              console.log(
                `[agent] Turn done but CP disconnected, keeping sink for reconnect session=${currentSessionId}`,
              )
            } else {
              activeSinks.delete(currentSessionId)
            }
          }
          doneResolve()
          clearInterval(keepaliveTimer)
        },
      },
      images,
    )
  })
})

// Get pending AskUserQuestion for a session (for recovery after UI refresh)
app.get('/sessions/:id/pending-question', (c) => {
  const sessionId = c.req.param('id')
  const question = getPendingQuestion(sessionId)
  return c.json(question)
})

// Respond to AskUserQuestion
app.post('/sessions/:id/respond', async (c) => {
  const body = await c.req.json<{
    requestId: string
    answers: Record<string, string>
  }>()
  const { requestId, answers } = body
  if (!requestId) {
    return c.json({ error: 'requestId is required' }, 400)
  }
  const ok = respondToQuestion(requestId, answers || {})
  return c.json({ success: ok })
})

// Reconnect to an ongoing turn (attach new SSE writer to existing session sink)
app.post('/sessions/:id/reconnect', async (c) => {
  const sessionId = c.req.param('id')
  const sink = activeSinks.get(sessionId)
  if (!sink) {
    return c.json({ error: 'No active session to reconnect' }, 404)
  }

  return streamSSE(c, async (stream) => {
    // Flush buffered messages
    const buffered = [...sink.buffer]
    sink.buffer = []
    for (const { event, data } of buffered) {
      await stream.writeSSE({ event, data })
    }

    // Attach new writer (captured so the abort listener can compare).
    let lastWriteAt = Date.now()
    const reconnectWriter: SessionSink['write'] = async (event, data) => {
      try {
        lastWriteAt = Date.now()
        await stream.writeSSE({ event, data })
      } catch {
        // Stream closed — silently drop
      }
    }
    sink.write = reconnectWriter

    // SSE comment-line heartbeat — see /chat handler for rationale.
    const KEEPALIVE_MS = 15_000
    const keepaliveTimer = setInterval(() => {
      if (sink.disconnected) return
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return
      stream.write(':\n\n').catch(() => {})
      lastWriteAt = Date.now()
    }, KEEPALIVE_MS)

    // Handle disconnect during reconnect — only switch to buffer mode if
    // we still own the writer.
    c.req.raw.signal.addEventListener('abort', () => {
      switchToBufferMode(sessionId, reconnectWriter)
      clearInterval(keepaliveTimer)
    })

    // Keep stream alive until the turn completes
    await sink.donePromise

    clearInterval(keepaliveTimer)
    // Clean up — turn is done and events have been flushed
    activeSinks.delete(sessionId)
  })
})

// Interrupt session (stop ongoing chat)
app.post('/sessions/:id/interrupt', (c) => {
  const sessionId = c.req.param('id')
  console.log(`[agent] Interrupt request session=${sessionId}`)
  const interrupted = interruptSession(sessionId)
  console.log(`[agent] Interrupt result session=${sessionId} interrupted=${interrupted}`)
  return c.json({ success: interrupted, interrupted })
})

// Reload config from CP (called by CP after config update)
// Accepts optional { scope: ["config", "skills", "credentials"] } to reload selectively
app.post('/reload-config', async (c) => {
  try {
    let scope: string[] | undefined
    try {
      const body = await c.req.json()
      scope = body?.scope
    } catch {
      // No body or invalid JSON — reload all (backward compat)
    }
    const all = !scope || scope.length === 0

    const configOk = all || scope!.includes('config') ? await loadConfig() : false
    const skillsResult =
      all || scope!.includes('skills') ? await loadSkills() : { ok: false, failed: [] }
    const credsOk = all || scope!.includes('credentials') ? await loadCredentials() : false

    if (configOk) console.log('[agent] Config reloaded from CP')
    if (skillsResult.ok) console.log('[agent] Skills reloaded from CP')
    if (credsOk) console.log('[agent] Credentials reloaded from CP')

    if (configOk || skillsResult.ok || credsOk) {
      // Surface skill failures so CP can log / retry; existing on-disk state
      // for failed skills is preserved by the atomic swap.
      return c.json({ success: true, skillsFailed: skillsResult.failed })
    }
    return c.json({ error: 'Failed to reload', skillsFailed: skillsResult.failed }, 500)
  } catch (e: any) {
    console.error('[agent] Failed to reload:', e)
    return c.json({ error: e.message }, 500)
  }
})

// ── Terminal WebSocket proxy: forward to ttyd on localhost:7681 ──

// Reject anything that isn't a safe tmux session name. We forward this to
// ttyd via ?arg=, which spawns `tmux ... -A -s <value>`, so unsafe chars
// would let a caller smuggle extra args. Bound length to keep tmux happy.
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/

app.get(
  '/terminal/ws',
  upgradeWebSocket((c) => {
    const rawSession = c.req.query('session')
    const session = rawSession && SESSION_RE.test(rawSession) ? rawSession : 'main'

    let backend: WebSocket | null = null
    let backendReady = false
    const pendingMessages: (Buffer | string)[] = []

    return {
      onOpen(_evt, ws) {
        backend = new WebSocket(`ws://localhost:7681/ws?arg=${encodeURIComponent(session)}`, [
          'tty',
        ])
        backend.binaryType = 'arraybuffer'

        backend.on('open', () => {
          backendReady = true
          // Flush messages buffered while connecting to ttyd
          for (const msg of pendingMessages) {
            backend!.send(msg)
          }
          pendingMessages.length = 0
        })
        backend.on('message', (data: ArrayBuffer | Buffer) => {
          if (data instanceof ArrayBuffer) {
            ws.send(new Uint8Array(data))
          } else {
            const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            ws.send(new Uint8Array(ab as ArrayBuffer))
          }
        })
        backend.on('close', () => {
          ws.close()
        })
        backend.on('error', () => {
          ws.close()
        })
      },
      onMessage(evt, _ws) {
        const data = evt.data
        if (backendReady && backend?.readyState === WebSocket.OPEN) {
          if (data instanceof ArrayBuffer) {
            backend.send(Buffer.from(data))
          } else if (typeof data === 'string') {
            backend.send(data)
          } else {
            backend.send(data)
          }
        } else {
          // Buffer messages until ttyd connection is ready
          if (data instanceof ArrayBuffer) {
            pendingMessages.push(Buffer.from(data))
          } else if (typeof data === 'string') {
            pendingMessages.push(data)
          } else {
            pendingMessages.push(Buffer.from(data as unknown as ArrayBuffer))
          }
        }
      },
      onClose() {
        if (backend && backend.readyState === WebSocket.OPEN) {
          backend.close()
        }
        backend = null
      },
      onError() {
        if (backend && backend.readyState === WebSocket.OPEN) {
          backend.close()
        }
        backend = null
      },
    }
  }),
)

// ── File browser proxy: forward to dufs ──
// /files/*     → localhost:8000 (workspace)
// /afs-files/* → localhost:8001 (afs shared mounts)

const PASSTHROUGH_RESPONSE_HEADERS = [
  'Content-Type',
  'Content-Disposition',
  'Content-Length',
  'ETag',
  'Last-Modified',
  'Cache-Control',
]

function makeDufsProxy(mountPrefix: string, origin: string) {
  return async (c: Context) => {
    const subPath = c.req.path.replace(mountPrefix, '') || '/'
    const url = new URL(c.req.url)
    const targetUrl = `${origin}${subPath}${url.search}`

    const reqHeaders = new Headers()
    reqHeaders.set('Accept-Encoding', 'identity')
    const dest = c.req.header('Destination')
    if (dest) {
      const destUrl = new URL(dest, 'http://localhost')
      const destPath = destUrl.pathname.replace(new RegExp(`^.*${mountPrefix}`), '')
      reqHeaders.set('Destination', `${origin}${destPath}`)
    }
    const contentType = c.req.header('Content-Type')
    if (contentType) reqHeaders.set('Content-Type', contentType)

    let body: ArrayBuffer | undefined
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      body = await c.req.arrayBuffer()
    }

    const resp = await fetch(targetUrl, {
      method: c.req.method,
      headers: reqHeaders,
      body,
    })

    const respHeaders = new Headers()
    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
      const value = resp.headers.get(name)
      if (value) respHeaders.set(name, value)
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    })
  }
}

app.all('/files/*', makeDufsProxy('/files', 'http://localhost:8000'))
app.all('/afs-files/*', makeDufsProxy('/afs-files', 'http://localhost:8001'))

// Execute a command in the workspace container
app.post('/exec', async (c) => {
  const body = await c.req.json<{ command: string[]; timeout_ms?: number }>()
  const { command, timeout_ms = 30_000 } = body

  if (!Array.isArray(command) || command.length === 0) {
    return c.json({ error: 'command must be a non-empty string array' }, 400)
  }

  const [cmd, ...args] = command
  try {
    const { stdout, stderr, exitCode } = await new Promise<{
      stdout: string
      stderr: string
      exitCode: number
    }>((resolve) => {
      execFile(
        cmd,
        args,
        {
          timeout: timeout_ms,
          maxBuffer: 1024 * 1024,
          cwd: WORKSPACE_DIR,
        },
        (err, stdout, stderr) => {
          resolve({
            stdout,
            stderr,
            exitCode: err ? ((err as any).code ?? 1) : 0,
          })
        },
      )
    })
    return c.json({ stdout, stderr, exitCode })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Reset workspace: remove all files except CLAUDE.md, .mcp.json, .claude/
app.get('/local/reset', async (c) => {
  const wsDir = process.env.WORKSPACE_DIR
  if (!wsDir) {
    return c.json({ error: 'WORKSPACE_DIR not set' }, 500)
  }

  const keep = new Set(['CLAUDE.md', '.mcp.json', '.claude'])
  const entries = await readdir(wsDir)
  const removed: string[] = []

  for (const entry of entries) {
    if (keep.has(entry)) continue
    await rm(join(wsDir, entry), { recursive: true, force: true })
    removed.push(entry)
  }

  // Memory used to live in workspace_memory + got cleared on reset. Memory
  // stores survive resets by design (cross-session is the whole point), so
  // /reset no longer touches them. To clear a store, the user uses the
  // Memory app.
  console.log(`[agent] Workspace reset: removed ${removed.length} entries`)
  return c.json({ success: true, removed })
})
