/**
 * Shared ACP agent HTTP server skeleton.
 *
 * Provides all standard agent endpoints parameterized by an AcpAgentServerConfig.
 * Each ACP agent (codex, goose, etc.) creates a thin wrapper that supplies
 * its agent-specific config and exports the resulting app.
 */

import { readFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpServer } from '@agentclientprotocol/sdk'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { streamSSE } from 'hono/streaming'
import WebSocket from 'ws'
import type { AgentCapabilities } from '../types/events.js'
import type { AcpBridge, AcpSessionHandler } from './acp-bridge.js'
import type { ChatRequest } from './types.js'
import { AcpEventTranslator } from './universal-events.js'

// ── Config interface ──

export interface AcpAgentServerConfig {
  agentType: string
  capabilities: AgentCapabilities
  keepFiles: Set<string>
  workspaceDir: string
  cpUrl?: string
  workspaceId?: string
  /**
   * Bridge process topology.
   *
   * - 'per-session' (default, codex): every ACP session gets its own child
   *   process. Needed when the ACP server binary is effectively
   *   single-session, and gives per-session crash/eviction isolation.
   * - 'shared' (goose): one child serves every session — ACP natively
   *   multiplexes sessions over a single connection. This is the correct
   *   topology when the agent keeps shared on-disk state: goose's sessions
   *   SQLite (WAL mode) sits on the workspace volume, which is typically
   *   NFS, and N concurrent per-session writer processes on a network
   *   filesystem is exactly the configuration SQLite documents as unsafe.
   *   A single process also drops idle memory (one runtime instead of N)
   *   and makes new sessions a session/new RPC instead of a process spawn.
   *   The shared child is still lazily spawned and reclaimed as a whole
   *   after the idle TTL — all durable state lives in the agent's store,
   *   so a respawn + session/load restores any session on demand.
   */
  bridgeMode?: 'per-session' | 'shared'
  loadMcpServers: (sessionToken?: string) => McpServer[]
  /** Whether MCP servers are configured in config.toml (requires waiting for startup) */
  hasMcpServers?: () => boolean
  loadConfig: () => Promise<boolean>
  loadSkills: () => Promise<{ ok: boolean; failed: string[] }>
  loadCredentials: () => Promise<boolean>
  /** Called after config/credentials reload to restart the ACP child process with updated env. */
  restartBridge?: () => Promise<void>
  /**
   * Called once per completed prompt turn with `PromptResponse.usage` (may be
   * undefined — codex never populates it). Agents whose transcripts the
   * agent-usage sweeper can't parse (goose persists sessions in SQLite)
   * implement this to append their own usage records for the `POST /usage`
   * pull. Must not throw; failures are logged and swallowed.
   */
  recordUsage?: (sessionId: string, usage: unknown) => void
}

// ── Session sink: replaceable SSE writer that survives UI refresh ──

interface SessionSink {
  write: (event: string, data: string) => Promise<void>
  buffer: Array<{ event: string; data: string }>
  disconnected: boolean
  doneResolve: () => void
  donePromise: Promise<void>
}

// ── Factory ──

export function createAcpAgentApp(config: AcpAgentServerConfig) {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  const sharedMode = config.bridgeMode === 'shared'

  // per-session mode: 1 bridge : 1 session — each ACP session gets its own
  // child process. (In shared mode this map stays empty; see the shared-state
  // block below.)
  let bridgeFactory: (() => Promise<AcpBridge>) | null = null
  const sessionBridges = new Map<string, AcpBridge>()
  // Per-session count of turns currently in flight. A reference count, not a
  // flag — concurrent turns can share one session's bridge (e.g. a page
  // refresh starting a fresh turn while an older one is still draining), and
  // the bridge is only safe to destroy once the count reaches zero.
  // /reload-config refuses to SIGTERM busy bridges mid-turn (would abort the
  // in-flight session with no termination event, leaving the scheduler's SSE
  // fetch to idle out ~4m).
  const busyTurns = new Map<string, number>()
  function isBusy(sid: string): boolean {
    return (busyTurns.get(sid) ?? 0) > 0
  }
  function enterTurn(sid: string): void {
    busyTurns.set(sid, (busyTurns.get(sid) ?? 0) + 1)
  }
  function exitTurn(sid: string): void {
    const n = (busyTurns.get(sid) ?? 0) - 1
    if (n > 0) busyTurns.set(sid, n)
    else busyTurns.delete(sid)
  }
  // Sessions whose bridge must be destroyed once all in-flight turns end, so
  // the next prompt re-spawns with the freshly reloaded env vars.
  const pendingDestroy = new Set<string>()

  // LRU eviction state. The bridge cache is a hot path optimization — the
  // /chat handler's loadSession branch (search for `loadSession(sessionId`)
  // already handles "no live bridge → spawn + load from rollout" identically
  // to the pod-restart cold path. So evicting idle bridges is safe; the cost
  // is one spawn (~1-2s) on the next prompt for that session.
  //
  // Why we cap: each codex-acp child holds ~127 MB resident. Container memory
  // limit is 2 GiB; without eviction, ~15 long-lived sessions saturate the
  // cgroup and kernel OOM-killer starts taking out random children, leaving
  // orphaned sessions stuck at chat_status='agent' in cp's DB.
  const bridgeLastActive = new Map<string, number>()
  const BRIDGE_IDLE_TTL_MS = Number(process.env.BRIDGE_IDLE_TTL_MS) || 10 * 60 * 1000
  const BRIDGE_MAX_COUNT = Number(process.env.BRIDGE_MAX_COUNT) || 10
  const BRIDGE_EVICT_INTERVAL_MS = Number(process.env.BRIDGE_EVICT_INTERVAL_MS) || 60 * 1000

  function touchBridge(sessionId: string) {
    bridgeLastActive.set(sessionId, Date.now())
    sharedLastActive = Date.now()
  }

  function setBridgeFactory(factory: () => Promise<AcpBridge>) {
    bridgeFactory = factory
  }

  // ── Shared-bridge state (bridgeMode: 'shared') ──
  // One lazily-spawned child serves every session. Reclaim is whole-process:
  // all durable session state lives in the agent's own store, so destroying
  // the child costs nothing beyond a respawn + session/load on next use.
  let sharedBridge: AcpBridge | null = null
  let sharedSpawn: Promise<AcpBridge> | null = null
  /** Sessions loaded/created in the CURRENT shared child (reset on destroy). */
  const sharedLoadedSessions = new Set<string>()
  let sharedLastActive = 0
  let sharedPendingDestroy = false

  function anyBusy(): boolean {
    return busyTurns.size > 0
  }

  function destroySharedBridge(reason: string) {
    if (!sharedBridge) return
    console.log(`[agent] Destroying shared bridge (${reason})`)
    sharedBridge.destroy()
    sharedBridge = null
    sharedLoadedSessions.clear()
    sharedPendingDestroy = false
    // The child is gone — any in-flight-turn accounting with it (see
    // destroyBridge for the per-session rationale).
    busyTurns.clear()
  }

  /** Return the live shared child, spawning it if needed (single-flight). */
  async function getSharedBridge(): Promise<AcpBridge> {
    if (sharedBridge?.isAlive()) return sharedBridge
    if (sharedBridge) destroySharedBridge('dead')
    if (!sharedSpawn) {
      sharedSpawn = (async () => {
        const spawnStart = Date.now()
        const b = await bridgeFactory!()
        sharedBridge = b
        sharedLastActive = Date.now()
        console.log(`[agent] Shared bridge spawned bridge_spawn=${Date.now() - spawnStart}ms`)
        return b
      })().finally(() => {
        sharedSpawn = null
      })
    }
    return sharedSpawn
  }

  // Shared-mode sweep: whole-process idle TTL + deferred-reload drain.
  function evictSharedBridge() {
    if (!sharedBridge) return
    if (anyBusy()) return
    if (sharedPendingDestroy) {
      destroySharedBridge('reload')
      return
    }
    if (Date.now() - sharedLastActive > BRIDGE_IDLE_TTL_MS) {
      destroySharedBridge('ttl')
    }
  }

  function destroyBridge(sessionId: string) {
    const b = sessionBridges.get(sessionId)
    if (!b) return
    b.destroy()
    sessionBridges.delete(sessionId)
    bridgeLastActive.delete(sessionId)
    pendingDestroy.delete(sessionId)
    // A destroyed bridge's in-flight-turn accounting is meaningless — the child
    // is gone. Clear it so a leaked count (e.g. a turn that never ran exitTurn
    // because its child died mid-turn) can't strand the next bridge for this
    // session as permanently "busy", blocking eviction/reload forever.
    busyTurns.delete(sessionId)
  }

  // Periodic bridge sweep: (0) drain reload/eviction-deferred destroys whose
  // turns have ended, (1) evict bridges idle longer than TTL, (2) evict the
  // oldest when over the cap. Busy bridges are never destroyed here — they go
  // into pendingDestroy and are drained once idle (here, or in the /chat
  // post-block, whichever runs first).
  function evictIdleBridges() {
    const now = Date.now()
    const evicted: string[] = []
    const deferred: string[] = []

    function tryEvict(sid: string, reason: string) {
      if (isBusy(sid)) {
        pendingDestroy.add(sid)
        deferred.push(`${sid}:${reason}`)
      } else {
        destroyBridge(sid)
        evicted.push(`${sid}:${reason}`)
      }
    }

    // Pass 0: drain destroys deferred while a turn was in flight, now idle.
    // The owning turn's /chat post-block is the primary drain; this is the
    // safety net for the case where that block was skipped (e.g. the handler
    // threw before reaching it), so a pendingDestroy entry can never leak.
    for (const sid of [...pendingDestroy]) {
      if (!sessionBridges.has(sid)) {
        pendingDestroy.delete(sid)
      } else if (!isBusy(sid)) {
        destroyBridge(sid)
        evicted.push(`${sid}:pending`)
      }
    }

    // Pass 1: TTL — anything idle longer than the threshold.
    for (const [sid, lastActive] of bridgeLastActive) {
      if (!sessionBridges.has(sid)) {
        bridgeLastActive.delete(sid)
        continue
      }
      if (now - lastActive > BRIDGE_IDLE_TTL_MS) {
        tryEvict(sid, 'ttl')
      }
    }

    // Pass 2: cap — if still over BRIDGE_MAX_COUNT, evict oldest non-busy until under.
    if (sessionBridges.size > BRIDGE_MAX_COUNT) {
      const sortedByAge = [...bridgeLastActive.entries()]
        .filter(([sid]) => sessionBridges.has(sid) && !pendingDestroy.has(sid))
        .sort((a, b) => a[1] - b[1])
      let overflow = sessionBridges.size - BRIDGE_MAX_COUNT
      for (const [sid] of sortedByAge) {
        if (overflow <= 0) break
        tryEvict(sid, 'cap')
        overflow--
      }
    }

    if (evicted.length || deferred.length) {
      console.log(
        `[agent] LRU evict: destroyed=${evicted.length} deferred=${deferred.length} live=${sessionBridges.size}/${BRIDGE_MAX_COUNT}`,
      )
    }
  }

  setInterval(sharedMode ? evictSharedBridge : evictIdleBridges, BRIDGE_EVICT_INTERVAL_MS).unref()

  // Destroy idle bridges now; defer busy ones until their turn completes.
  function destroyIdleBridges() {
    if (sharedMode) {
      if (!sharedBridge) return { destroyed: 0, deferred: 0 }
      if (anyBusy()) {
        sharedPendingDestroy = true
        return { destroyed: 0, deferred: 1 }
      }
      destroySharedBridge('reload')
      return { destroyed: 1, deferred: 0 }
    }
    let destroyed = 0
    let deferred = 0
    for (const sid of [...sessionBridges.keys()]) {
      if (isBusy(sid)) {
        pendingDestroy.add(sid)
        deferred++
      } else {
        destroyBridge(sid)
        destroyed++
      }
    }
    return { destroyed, deferred }
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

  // Health check — returns 503 if bridge factory is not set
  app.get('/health', (c) => {
    if (!bridgeFactory) {
      return c.json({ status: 'error', reason: 'bridge factory not initialized' }, 503)
    }
    return c.json({ status: 'ok' })
  })

  // Info — AgentInfo contract
  app.get('/info', (c) => {
    let runtime: { model?: string; provider_type?: string } = {}
    try {
      runtime = JSON.parse(readFileSync(join(config.workspaceDir, 'runtime.json'), 'utf-8'))
    } catch {}
    return c.json({
      agent_type: config.agentType,
      model: runtime.model || 'default',
      capabilities: config.capabilities,
    })
  })

  // Chat - SSE streaming endpoint
  app.post('/chat', async (c) => {
    const body = await c.req.json<ChatRequest>()
    const { message, session_id: sessionId, images, session_token: sessionToken } = body
    // session_token: CP-minted opaque proxy id for this session. ACP
    // binds MCP servers at createSession/loadSession (we can't rewire per
    // turn), so the token is carried into headers there and stays for the
    // session's life. CP reverse-resolves it on each MCP call.

    if (!message) {
      return c.json({ error: 'Message is required' }, 400)
    }

    if (!bridgeFactory) {
      return c.json({ error: 'ACP bridge factory not initialized' }, 503)
    }

    return streamSSE(c, async (stream) => {
      let doneResolve!: () => void
      const donePromise = new Promise<void>((r) => {
        doneResolve = r
      })
      // Capture a stable reference to this handler's writer so the abort
      // listener below can tell whether a later `/reconnect` has replaced
      // `sink.write`.
      let lastWriteAt = Date.now()
      const chatWriter: SessionSink['write'] = async (event, data) => {
        lastWriteAt = Date.now()
        await stream.writeSSE({ event, data })
      }
      const sink: SessionSink = {
        write: chatWriter,
        buffer: [],
        disconnected: false,
        doneResolve,
        donePromise,
      }
      // SSE comment-line heartbeat. Long sub-agent / shell tool runs can
      // leave the writer idle for many minutes, and ~5min of TCP idle
      // reliably gets the cp↔agent stream killed by some intermediate
      // (Node http, kube-proxy/conntrack, undici recycle), surfacing as
      // `terminated` on cp's side. Writing a `:` comment frame every
      // KEEPALIVE_MS of writer-idle keeps the stream warm; readSSE
      // ignores comment lines per the SSE spec, so cp sees nothing.
      const KEEPALIVE_MS = 15_000
      const keepaliveTimer = setInterval(() => {
        if (sink.disconnected) return
        if (Date.now() - lastWriteAt < KEEPALIVE_MS) return
        stream.write(':\n\n').catch(() => {})
        lastWriteAt = Date.now()
      }, KEEPALIVE_MS)

      const translator = new AcpEventTranslator(sessionId)
      let currentSessionId: string | undefined
      let currentBridge: AcpBridge | undefined
      // True when this turn ran on a bridge pulled from the cache rather than a
      // fresh spawn. Only reused bridges can be "process-alive but session-dead"
      // (see the prompt rebuild path below); a just-loaded/created bridge that
      // fails has a genuine cause, so we never blind-retry it.
      let reusedBridge = false
      // Set once the turn emits any translated event. Guards the rebuild-retry:
      // we only auto-recover a prompt that failed producing *nothing* (the
      // poisoned-session signature — instant reject, no output); a mid-turn
      // failure after partial output must not be retried (would duplicate).
      let turnProducedOutput = false
      const chatStartedAt = Date.now()

      try {
        // ── Shared mode: resolve the session on the single shared child. The
        // per-session blocks below then no-op naturally (sessionBridges stays
        // empty and currentSessionId is already set), and the final else-branch
        // emits session.started exactly once for every shared path.
        if (sharedMode) {
          const bridge = await getSharedBridge()
          currentBridge = bridge
          if (sessionId && sharedLoadedSessions.has(sessionId)) {
            // Session already live in the shared child — nothing to load.
            currentSessionId = sessionId
            reusedBridge = true
            activeSinks.set(sessionId, sink)
            touchBridge(sessionId)
          } else if (sessionId) {
            // Load persisted state into the shared child. Handler is
            // registered after the load on purpose — loadSession replays the
            // conversation history as notifications, and this session has no
            // handler yet, so the replay is dropped instead of streamed.
            try {
              const loadStart = Date.now()
              currentSessionId = await bridge.loadSession(sessionId, {
                mcpServers: config.loadMcpServers(sessionToken),
              })
              sharedLoadedSessions.add(currentSessionId)
              activeSinks.set(currentSessionId, sink)
              touchBridge(currentSessionId)
              console.log(
                `[agent] Loaded persisted session=${currentSessionId} session_load=${Date.now() - loadStart}ms (shared)`,
              )
            } catch (err: any) {
              // Same cross-core-resume framing as the per-session path below,
              // but do NOT destroy the shared child — other sessions live in it.
              console.error(`[agent] loadSession failed session=${sessionId}:`, err)
              const detail = err?.data?.message || err?.message || String(err)
              throw new Error(
                `Cannot continue this session: its session record was not found. ` +
                  `It was most likely created under a different agent type, and sessions ` +
                  `cannot continue after switching agent type. Switch the workspace's agent ` +
                  `type back to the original one and try again. (${detail})`,
              )
            }
          } else {
            const createStart = Date.now()
            currentSessionId = await bridge.createSession({
              mcpServers: config.loadMcpServers(sessionToken),
            })
            sharedLoadedSessions.add(currentSessionId)
            activeSinks.set(currentSessionId, sink)
            touchBridge(currentSessionId)
            console.log(
              `[agent] Session created session=${currentSessionId} session_create=${Date.now() - createStart}ms (shared)`,
            )
            if (config.hasMcpServers?.()) {
              await bridge.waitForMcpReady()
            }
          }
        }

        // Get, load, or create ACP session — each session has its own bridge process.
        if (sessionId && sessionBridges.has(sessionId)) {
          const existing = sessionBridges.get(sessionId)!
          if (existing.isAlive()) {
            // Reuse existing bridge for this session
            currentBridge = existing
            currentSessionId = sessionId
            reusedBridge = true
            activeSinks.set(sessionId, sink)
            touchBridge(sessionId)
            console.log(
              `[agent] Reusing bridge session=${sessionId} bridge_reuse=${Date.now() - chatStartedAt}ms`,
            )
          } else {
            // Bridge died — remove stale entry, will fall through to loadSession
            console.warn(`[agent] Bridge dead for session=${sessionId}, replacing`)
            existing.destroy()
            sessionBridges.delete(sessionId)
          }
        }

        if (!currentSessionId && sessionId) {
          // Session not active — spawn a new bridge and try to load persisted state.
          const bridgeStart = Date.now()
          const newBridge = await bridgeFactory!()
          console.log(
            `[agent] Bridge spawned session=${sessionId} bridge_spawn=${Date.now() - bridgeStart}ms`,
          )
          try {
            const loadStart = Date.now()
            const mcpServers = config.loadMcpServers(sessionToken)
            // Don't register handler before loadSession — the ACP protocol
            // replays the full conversation history via notifications during
            // loadSession, and we don't want those replayed events in the SSE
            // stream (the client loads history from the DB).
            currentSessionId = await newBridge.loadSession(sessionId, {
              mcpServers,
            })
            currentBridge = newBridge
            sessionBridges.set(currentSessionId, newBridge)
            activeSinks.set(currentSessionId, sink)
            touchBridge(currentSessionId)
            console.log(
              `[agent] Loaded persisted session=${currentSessionId} session_load=${Date.now() - loadStart}ms`,
            )
          } catch (err: any) {
            // loadSession failed (id not owned by this core, rollout missing, etc.).
            // Don't silently fall through to createSession — that splits the
            // conversation (user msg on old session, agent reply on new) and
            // leaves the old session stuck at chat_status='agent'. Surface the
            // error to cp so it can fail the turn explicitly.
            //
            // ~99% of the time this is a cross-core resume: each agent core only
            // persists its own session/rollout files, so a session created under
            // a different agent type can't be loaded here. Wrap the raw "not
            // found" in an actionable hint so the user knows to switch the
            // workspace's agent type back, instead of seeing an opaque error.
            newBridge.destroy()
            console.error(`[agent] loadSession failed session=${sessionId}:`, err)
            const detail = err?.data?.message || err?.message || String(err)
            throw new Error(
              `Cannot continue this session: its session record was not found. ` +
                `It was most likely created under a different agent type, and sessions ` +
                `cannot continue after switching agent type. Switch the workspace's agent ` +
                `type back to the original one and try again. (${detail})`,
            )
          }
        }

        if (!currentSessionId) {
          // Create a brand new bridge + session
          const bridgeStart = Date.now()
          const newBridge = await bridgeFactory!()
          console.log(
            `[agent] Bridge spawned (new session) bridge_spawn=${Date.now() - bridgeStart}ms`,
          )
          const createStart = Date.now()
          const mcpServers = config.loadMcpServers(sessionToken)
          currentSessionId = await newBridge.createSession({ mcpServers })
          console.log(
            `[agent] Session created session=${currentSessionId} session_create=${Date.now() - createStart}ms`,
          )
          currentBridge = newBridge
          sessionBridges.set(currentSessionId, newBridge)
          activeSinks.set(currentSessionId, sink)
          touchBridge(currentSessionId)

          // Wait for MCP servers to finish startup before sending the first prompt.
          if (config.hasMcpServers?.()) {
            const mcpStart = Date.now()
            await newBridge.waitForMcpReady()
            console.log(
              `[agent] MCP ready session=${currentSessionId} mcp_wait=${Date.now() - mcpStart}ms`,
            )
          }

          // Emit session.started with the new session ID
          const evt = translator.sessionStarted(currentSessionId)
          await sink.write('message', JSON.stringify(evt))
        } else {
          // Resume paths (bridge reuse / loadSession) — still emit session.started
          // so downstream consumers (scheduler) always receive the session ID
          const evt = translator.sessionStarted(currentSessionId)
          await sink.write('message', JSON.stringify(evt))
        }

        // Register session handler (loadSession path registers early; skip if already done)
        if (!activeSinks.has(currentSessionId)) {
          activeSinks.set(currentSessionId, sink)
        }
        const sessionHandler: AcpSessionHandler = {
          onUpdate(update) {
            for (const evt of translator.translateUpdate(update)) {
              turnProducedOutput = true
              sink.write('message', JSON.stringify(evt))
            }
          },
          async onPermissionRequest(req) {
            const optionId = req.options?.[0]?.optionId ?? 'allow-once'
            return { outcome: { outcome: 'selected' as const, optionId } }
          },
        }
        currentBridge!.registerHandler(currentSessionId, sessionHandler)

        // Handle client disconnect. Only switch to buffer mode if we still
        // own `sink.write` — if a `/reconnect` handler has taken over, leave
        // it alone.
        c.req.raw.signal.addEventListener('abort', () => {
          console.log(`[agent] Client aborted connection session=${currentSessionId}`)
          switchToBufferMode(currentSessionId!, chatWriter)
          clearInterval(keepaliveTimer)
        })

        // Run one turn on `bridge`, keeping the busy-turn count balanced.
        async function runTurn(bridge: AcpBridge) {
          enterTurn(currentSessionId!)
          try {
            return await bridge.prompt(currentSessionId!, message, images)
          } finally {
            exitTurn(currentSessionId!)
            touchBridge(currentSessionId!)
          }
        }

        // Send prompt and wait for turn completion
        const initMs = Date.now() - chatStartedAt
        console.log(`[agent] Prompting session=${currentSessionId} init_total=${initMs}ms`)
        const promptStart = Date.now()
        let result
        try {
          result = await runTurn(currentBridge!)
        } catch (promptErr: any) {
          // A cached bridge can be alive at the OS-process level yet have a
          // poisoned in-codex session (e.g. a prior turn's child died / was
          // interrupted mid-flight), so every reused prompt rejects instantly
          // with no output and the session is stranded — retry and "continue"
          // both keep hitting the same dead session. isAlive() (process-level)
          // can't see this. When a *reused* bridge fails having produced
          // nothing, force-rebuild from the persisted rollout and retry the
          // prompt once. A freshly loaded child that fails again means the
          // cause is upstream/content (not a stuck bridge), so we let it throw.
          if (!reusedBridge || turnProducedOutput) throw promptErr
          console.warn(
            `[agent] Reused bridge failed with no output, rebuilding session=${currentSessionId}: ${promptErr?.message ?? promptErr}`,
          )
          if (sharedMode) {
            // Reload just this session. If the shared child itself died,
            // getSharedBridge respawns it (destroying the dead one clears
            // sharedLoadedSessions — other sessions lazily reload on their
            // next prompt). If the child is alive, re-load in place:
            // unregister the handler first so the load's history replay
            // isn't streamed into this SSE.
            currentBridge!.unregisterHandler(currentSessionId)
            const bridge = await getSharedBridge()
            await bridge.loadSession(currentSessionId, {
              mcpServers: config.loadMcpServers(sessionToken),
            })
            sharedLoadedSessions.add(currentSessionId)
            currentBridge = bridge
            reusedBridge = false
            activeSinks.set(currentSessionId, sink)
            touchBridge(currentSessionId)
            bridge.registerHandler(currentSessionId, sessionHandler)
            console.log(
              `[agent] Reloaded session in shared bridge, retrying session=${currentSessionId}`,
            )
            result = await runTurn(bridge)
            console.log(`[agent] Shared bridge recovered session=${currentSessionId}`)
          } else {
            destroyBridge(currentSessionId)
            const rebuilt = await bridgeFactory!()
            await rebuilt.loadSession(currentSessionId, {
              mcpServers: config.loadMcpServers(sessionToken),
            })
            currentBridge = rebuilt
            reusedBridge = false
            sessionBridges.set(currentSessionId, rebuilt)
            activeSinks.set(currentSessionId, sink)
            touchBridge(currentSessionId)
            rebuilt.registerHandler(currentSessionId, sessionHandler)
            console.log(`[agent] Rebuilt bridge, retrying prompt session=${currentSessionId}`)
            result = await runTurn(rebuilt)
            console.log(`[agent] Rebuilt bridge recovered session=${currentSessionId}`)
          }
        }
        console.log(
          `[agent] Prompt done session=${currentSessionId} prompt=${Date.now() - promptStart}ms total=${Date.now() - chatStartedAt}ms`,
        )

        if (config.recordUsage) {
          try {
            config.recordUsage(currentSessionId!, (result as { usage?: unknown }).usage)
          } catch (usageErr) {
            console.error(`[agent] recordUsage failed session=${currentSessionId}:`, usageErr)
          }
        }

        // Finalize any in-progress message item
        for (const evt of translator.finalize()) {
          await sink.write('message', JSON.stringify(evt))
        }

        const reason = result.stopReason === 'cancelled' ? 'interrupted' : 'completed'
        const stats = translator.buildStats(result)
        await sink.write('message', JSON.stringify(translator.sessionEnded(reason, stats)))
      } catch (err: any) {
        // ACP agents (Codex/Claude) surface upstream errors as JSON-RPC
        // -32603 with a generic "Internal error" message; the actionable
        // cause (e.g. OpenAI content-policy reason, rate-limit detail) sits
        // in err.data.message. Prefer that, append a short code tag if we
        // have one (e.g. "cyber_policy"), otherwise fall back.
        const cause = err.data?.message
        const tag = err.data?.codex_error_info ?? err.data?.error_code
        const msg = cause ? (tag ? `${cause} (${tag})` : cause) : err.message || JSON.stringify(err)
        console.error(`[agent] Chat error session=${currentSessionId}:`, msg)
        await sink.write('message', JSON.stringify(translator.error(msg)))
        await sink.write('message', JSON.stringify(translator.sessionEnded('error')))
      }

      if (currentSessionId) {
        currentBridge?.unregisterHandler(currentSessionId)
        const currentSink = activeSinks.get(currentSessionId)
        if (currentSink?.disconnected) {
          // CP disconnected — keep sink alive for reconnect to flush buffered events
          console.log(
            `[agent] Turn done but CP disconnected, keeping sink for reconnect session=${currentSessionId}`,
          )
        } else {
          activeSinks.delete(currentSessionId)
        }
        // Drain a destroy that /reload-config or LRU eviction deferred while a
        // turn was in flight. Re-check busy state first: concurrent turns can
        // share this session's bridge (e.g. a page refresh starting a new
        // turn), and destroying it now would abort the still-running turn with
        // "AcpBridge destroyed". Leave the entry in pendingDestroy — whichever
        // turn exits last drains it once the bridge is genuinely idle.
        if (sharedMode) {
          if (sharedPendingDestroy) {
            if (anyBusy()) {
              console.log('[agent] Shared bridge destroy still deferred — turns in flight')
            } else {
              destroySharedBridge('reload-deferred')
            }
          }
        } else if (pendingDestroy.has(currentSessionId)) {
          if (isBusy(currentSessionId)) {
            console.log(
              `[agent] Bridge destroy still deferred — another turn in flight session=${currentSessionId}`,
            )
          } else {
            console.log(`[agent] Destroying bridge deferred by reload session=${currentSessionId}`)
            destroyBridge(currentSessionId)
          }
        }
      }
      clearInterval(keepaliveTimer)
      doneResolve()
    })
  })

  // Get pending question for a session (stub — ACP uses permissions, not ASQ)
  app.get('/sessions/:id/pending-question', (c) => {
    return c.json(null)
  })

  // Respond to pending question (stub)
  app.post('/sessions/:id/respond', async (c) => {
    return c.json({ success: false, error: 'Not supported' }, 501)
  })

  // Reconnect to an ongoing turn
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
        lastWriteAt = Date.now()
        await stream.writeSSE({ event, data })
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

  // Interrupt session
  app.post('/sessions/:id/interrupt', (c) => {
    const sessionId = c.req.param('id')
    console.log(`[agent] Interrupt request session=${sessionId}`)
    const bridge = sharedMode
      ? sharedLoadedSessions.has(sessionId)
        ? sharedBridge
        : null
      : sessionBridges.get(sessionId)
    if (bridge) {
      bridge.cancel(sessionId)
      return c.json({ success: true, interrupted: true })
    }
    return c.json({ success: false, interrupted: false })
  })

  // Reload config from CP
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

      const configOk = all || scope!.includes('config') ? await config.loadConfig() : false
      const skillsResult =
        all || scope!.includes('skills')
          ? await config.loadSkills()
          : { ok: false, failed: [] as string[] }
      const credsOk = all || scope!.includes('credentials') ? await config.loadCredentials() : false

      if (configOk) console.log('[agent] Config reloaded from CP')
      if (skillsResult.ok) console.log('[agent] Skills reloaded from CP')
      if (credsOk) console.log('[agent] Credentials reloaded from CP')

      if (configOk || skillsResult.ok || credsOk) {
        // Destroy all bridge processes so they pick up new env vars on next use.
        if ((configOk || credsOk) && config.restartBridge) {
          try {
            await config.restartBridge()
            const { destroyed, deferred } = destroyIdleBridges()
            console.log(
              `[agent] ACP bridges after reload: destroyed=${destroyed} deferred_until_turn_end=${deferred}`,
            )
          } catch (e: any) {
            console.error('[agent] Failed to refresh ACP bridge env:', e)
          }
        }
        // skillsFailed surfaces names whose download exhausted retries; the
        // atomic swap preserved their previous on-disk state so the workspace
        // stays usable, but CP can use this to alert / retry.
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

  // biome-ignore lint/suspicious/noExplicitAny: hono Context across package boundaries
  function makeDufsProxy(mountPrefix: string, origin: string) {
    return async (c: any) => {
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

  // Reset workspace
  app.get('/local/reset', async (c) => {
    const wsDir = config.workspaceDir
    if (!wsDir) {
      return c.json({ error: 'WORKSPACE_DIR not set' }, 500)
    }

    const entries = await readdir(wsDir)
    const removed: string[] = []

    for (const entry of entries) {
      if (config.keepFiles.has(entry)) continue
      await rm(join(wsDir, entry), { recursive: true, force: true })
      removed.push(entry)
    }

    // Memory stores survive reset by design — see the comment in
    // claude-code/src/server.ts /reset for the rationale.
    console.log(`[agent] Workspace reset: removed ${removed.length} entries`)
    return c.json({ success: true, removed })
  })

  return { app, injectWebSocket, setBridgeFactory }
}
