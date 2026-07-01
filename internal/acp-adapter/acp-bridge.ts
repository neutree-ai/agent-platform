/**
 * ACP bridge using the official @agentclientprotocol/sdk.
 *
 * Spawns an ACP-native agent (e.g. `opencode acp`) as a child process,
 * creates a ClientSideConnection over nd-JSON stdio, and provides a
 * thin session-management API to the rest of the adapter.
 *
 * Reusable for any ACP agent (OpenCode, Codex, Goose, Gemini CLI, etc.).
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Readable, Writable } from 'node:stream'
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  type McpServer,
  PROTOCOL_VERSION,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
  ndJsonStream,
} from '@agentclientprotocol/sdk'
import { formatAttachmentNote, writeInputAttachments } from '../types/attachments.js'
import type { ChatImageAttachment } from '../types/events.js'

// Re-export SDK types that consumers need
export type {
  McpServer,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
}

// ── Bridge options ──

export interface AcpBridgeOptions {
  program: string // e.g. 'opencode'
  args: string[] // e.g. ['acp']
  cwd: string // workspace dir
  env?: Record<string, string>
}

// ── Per-session handler ──

export interface AcpSessionHandler {
  onUpdate(update: SessionUpdate): void
  onPermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
}

// ── Bridge ──

/**
 * Thrown when the codex-acp child process exits while a prompt is in flight.
 * The /chat handler's catch block surfaces this as a session-ended-with-error
 * SSE event so cp can flip chat_status back to idle — without this, the
 * awaiting prompt promise never settles and the session is stuck at 'agent'
 * forever (the OOM hang pattern from 2026-05-19).
 */
export class BridgeChildDiedError extends Error {
  constructor(code: number | null, signal: NodeJS.Signals | null) {
    super(`codex-acp child exited unexpectedly: code=${code} signal=${signal}`)
    this.name = 'BridgeChildDiedError'
  }
}

export class AcpBridge {
  private child: ChildProcess | null = null
  private connection: ClientSideConnection | null = null
  private options: AcpBridgeOptions
  private sessionHandlers = new Map<string, AcpSessionHandler>()
  private mcpReadyPromise: Promise<void> | null = null
  private pendingPromptRejects = new Map<string, (err: Error) => void>()
  private destroyed = false

  constructor(options: AcpBridgeOptions) {
    this.options = options
  }

  /**
   * Spawn the ACP child process and perform the `initialize` handshake.
   */
  async start(): Promise<void> {
    // The TypeScript codex-acp (app-server protocol) has no global stderr
    // startup marker: MCP servers start per-session and only *failures* surface,
    // as tool_call_update notifications routed through the normal session
    // handler. So we don't set RUST_LOG (a Rust-only knob) and don't gate the
    // first turn on a stderr line that never arrives — see waitForMcpReady,
    // which now resolves once `initialize` succeeds.
    const env = { ...process.env, ...this.options.env }

    this.child = spawn(this.options.program, this.options.args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.on('error', (err) => {
      console.error(`[acp-bridge] Process error: ${err.message}`)
    })

    // Readiness gate (see waitForMcpReady). Non-null no-op default so it's
    // always callable; resolving a Promise more than once is a harmless no-op.
    let resolveReady: () => void = () => {}
    this.mcpReadyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    this.child.on('exit', (code, signal) => {
      console.warn(`[acp-bridge] Process exited: code=${code} signal=${signal}`)
      // Resolve MCP ready if the process exits before the handshake unblocks it.
      resolveReady()
      // Reject any in-flight prompt promises so the awaiting /chat handler
      // doesn't hang forever. Skip if destroy() was called intentionally —
      // those rejections are issued explicitly below.
      if (!this.destroyed && this.pendingPromptRejects.size > 0) {
        const err = new BridgeChildDiedError(code, signal)
        const pending = [...this.pendingPromptRejects.values()]
        this.pendingPromptRejects.clear()
        for (const reject of pending) reject(err)
      }
    })

    // Capture stderr: forward to console for diagnostics. (Readiness is no
    // longer derived from stderr — see start()'s comment and waitForMcpReady.)
    const stderrRl = createInterface({ input: this.child.stderr! })
    stderrRl.on('line', (line) => {
      // Strip ANSI escape codes for cleaner log output
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
      console.error(`[codex-acp] ${clean}`)
    })

    const input = Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>
    const output = Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>

    const self = this

    const client: Client = {
      async sessionUpdate(params: SessionNotification) {
        const handler = self.sessionHandlers.get(params.sessionId)
        if (handler) {
          handler.onUpdate(params.update)
        } else {
          console.warn(`[acp-bridge] session/update for unknown session: ${params.sessionId}`)
        }
      },

      async requestPermission(params: RequestPermissionRequest) {
        const handler = self.sessionHandlers.get(params.sessionId)
        if (handler) {
          return handler.onPermissionRequest(params)
        }
        // Auto-approve with first option
        const optionId = params.options?.[0]?.optionId ?? 'allow-once'
        return { outcome: { outcome: 'selected' as const, optionId } }
      },
    }

    this.connection = new ClientSideConnection(() => client, ndJsonStream(input, output))

    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })

    console.log('[acp-bridge] Initialized')

    // The new codex-acp manages MCP startup per-session internally and emits no
    // positive "ready" signal (only per-server failures, as tool_call_update
    // notifications). There is nothing to wait for, so unblock waitForMcpReady
    // now that the handshake is up; MCP failures still surface through the
    // normal session handler.
    resolveReady()
  }

  /**
   * Legacy hook from the Rust codex-acp era, where the first turn was gated on
   * a global `McpStartupComplete` stderr marker. The TypeScript codex-acp has
   * no such marker — MCP servers start per-session and only failures are
   * reported — so this now resolves as soon as the `initialize` handshake
   * completes. Kept (rather than removed at the call sites) so the orchestration
   * in acp-server.ts stays untouched and a future readiness signal can re-hook
   * here. `timeoutMs` is retained as a backstop for the pre-handshake window.
   */
  async waitForMcpReady(timeoutMs = 35_000): Promise<void> {
    if (!this.mcpReadyPromise) return
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[acp-bridge] MCP startup wait timed out after ${timeoutMs}ms`)
        resolve()
      }, timeoutMs)
    })
    await Promise.race([this.mcpReadyPromise, timeout])
    clearTimeout(timer!)
  }

  /**
   * Create a new ACP session. Returns the session ID.
   */
  async createSession(opts?: {
    cwd?: string
    mcpServers?: McpServer[]
  }): Promise<string> {
    if (!this.connection) throw new Error('ACP bridge not started')
    const result = await this.connection.newSession({
      cwd: opts?.cwd ?? this.options.cwd,
      mcpServers: opts?.mcpServers ?? [],
    })
    return result.sessionId
  }

  /**
   * Load (restore) a previously persisted session. Returns the session ID.
   * Throws if the agent doesn't support loadSession or the session is not found.
   */
  async loadSession(
    sessionId: string,
    opts?: {
      cwd?: string
      mcpServers?: McpServer[]
    },
  ): Promise<string> {
    if (!this.connection) throw new Error('ACP bridge not started')
    await this.connection.loadSession({
      sessionId,
      cwd: opts?.cwd ?? this.options.cwd,
      mcpServers: opts?.mcpServers ?? [],
    })
    // LoadSessionResponse doesn't include sessionId — the loaded session
    // keeps the same ID that was passed in.
    return sessionId
  }

  /**
   * Register a handler for session updates and permission requests.
   */
  registerHandler(sessionId: string, handler: AcpSessionHandler): void {
    this.sessionHandlers.set(sessionId, handler)
  }

  /**
   * Unregister the handler for a session.
   */
  unregisterHandler(sessionId: string): void {
    this.sessionHandlers.delete(sessionId)
  }

  /**
   * Send a prompt to an existing session. Resolves when the turn completes.
   * During execution, session updates flow through the registered handler.
   */
  async prompt(
    sessionId: string,
    text: string,
    images?: ChatImageAttachment[],
  ): Promise<PromptResponse> {
    if (!this.connection) throw new Error('ACP bridge not started')
    const contentBlocks: ContentBlock[] = []
    let promptText = text
    if (images?.length) {
      for (const img of images) {
        contentBlocks.push({ type: 'image', data: img.data, mimeType: img.media_type })
      }
      // Also persist the images as files so the model can hand them to tools
      // that need a real file or URL — the ACP image block only feeds vision,
      // it does not expose a path the model can pass downstream.
      const written = writeInputAttachments(images, { workspaceDir: this.options.cwd, sessionId })
      promptText += formatAttachmentNote(written)
    }
    contentBlocks.push({ type: 'text', text: promptText })
    // Race the protocol-level prompt against a child-died rejection so the
    // promise actually settles when codex-acp gets OOM-killed mid-turn.
    return new Promise<PromptResponse>((resolve, reject) => {
      this.pendingPromptRejects.set(sessionId, reject)
      this.connection!.prompt({ sessionId, prompt: contentBlocks })
        .then(resolve, reject)
        .finally(() => {
          // Only clear our own entry — concurrent prompts on different
          // sessions share this map.
          const current = this.pendingPromptRejects.get(sessionId)
          if (current === reject) this.pendingPromptRejects.delete(sessionId)
        })
    })
  }

  /**
   * Cancel an ongoing prompt turn.
   */
  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) throw new Error('ACP bridge not started')
    await this.connection.cancel({ sessionId })
  }

  /**
   * Check if the child process is still running.
   */
  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null
  }

  /**
   * Kill the child process and clean up.
   */
  destroy(): void {
    this.destroyed = true
    // Reject any in-flight prompts before tearing down so the awaiting
    // /chat handler unblocks immediately instead of waiting for the child
    // exit signal.
    if (this.pendingPromptRejects.size > 0) {
      const err = new Error('AcpBridge destroyed')
      const pending = [...this.pendingPromptRejects.values()]
      this.pendingPromptRejects.clear()
      for (const reject of pending) reject(err)
    }
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    this.connection = null
    this.sessionHandlers.clear()
    this.mcpReadyPromise = null
  }
}
