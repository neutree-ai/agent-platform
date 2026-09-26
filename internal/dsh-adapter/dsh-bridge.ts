/**
 * Bridge to a DeepSeek Harness runtime, driven over the SDK's stdio JSON-RPC.
 *
 * Implements the same `AgentBridge` contract the ACP bridge does, so the shared
 * server skeleton — SSE sinks, reconnect, LRU eviction, config reload — serves
 * dsh unchanged. Everything dsh-specific is confined to this file,
 * `dsh-runtime.ts`, and `dsh-events.ts`.
 *
 * Two things differ from an ACP agent and shape the design:
 *
 *  - **Sessions are implicit.** dsh has no create/load call; a prompt names its
 *    session and the runtime creates it, or the platform's server plugin
 *    resumes it from its persisted log. `createSession`/`loadSession`
 *    therefore only fix the id this bridge serves.
 *  - **MCP servers are composed, not negotiated.** They come from the generated
 *    composition the runtime boots with, so the MCP arguments are ignored and
 *    readiness is settled before the first prompt.
 */

import type { McpServer, PromptResponse, SessionUpdate } from '@agentclientprotocol/sdk'
import type { ChatImageAttachment } from '../types/events.js'
import { formatAttachmentNote, writeInputAttachments } from '../types/attachments.js'
import type { AcpSessionHandler } from '../acp-adapter/acp-bridge.js'
import { createTurnAccumulator, DshEventTranslator } from './dsh-events.js'
import { type DshLaunchSpec, DshRuntime, DshRuntimeDiedError } from './dsh-runtime.js'

export { type DshLaunchSpec, DshRuntimeDiedError }

export interface DshBridgeOptions {
  /** Workspace directory; the session's cwd and the runtime's own cwd. */
  cwd: string
  /**
   * The session this bridge serves. The server skeleton mints it before the
   * bridge exists (a draft uuid for a new session, the stored id for an
   * existing one), and dsh takes the platform id verbatim.
   */
  sessionId: string
  /**
   * Resolved once, on the first prompt rather than at construction. The
   * composition a dsh runtime boots with carries the session's MCP servers,
   * and their per-session token only reaches the agent after the bridge is
   * built — so the config file cannot be written any earlier. Deferring also
   * means a config reload lands on the next spawn instead of needing its own
   * plumbing.
   */
  resolveLaunch: (sessionId: string) => Promise<DshLaunchSpec>
}

export class DshBridge {
  private runtime: DshRuntime | undefined
  private handler: AcpSessionHandler | undefined
  private sessionId: string | undefined
  private destroyed = false
  private started = false
  /** Set when the user stops the turn, so a runtime ended for it reads as a cancel. */
  private cancelRequested = false

  constructor(private readonly options: DshBridgeOptions) {}

  /** No process yet — see `resolveLaunch`. Marks the bridge usable. */
  async start(): Promise<void> {
    if (this.destroyed) throw new Error('dsh bridge destroyed')
    this.started = true
  }

  /** Spawn the runtime and complete the handshake, once per bridge. */
  private async ensureRuntime(sessionId: string): Promise<DshRuntime> {
    if (this.runtime !== undefined) return this.runtime
    const spec = await this.options.resolveLaunch(sessionId)
    const runtime = new DshRuntime(spec, this.options.cwd)
    try {
      await runtime.start()
    } catch (error) {
      await runtime.close()
      throw error
    }
    this.runtime = runtime
    return runtime
  }

  /**
   * dsh mints no id of its own, so the draft id this bridge was built with is
   * the session id. Nothing is created until the first prompt names it.
   */
  async createSession(_opts?: { cwd?: string; mcpServers?: McpServer[] }): Promise<string> {
    this.sessionId = this.options.sessionId
    return this.sessionId
  }

  /**
   * Bind this bridge to an existing session. The runtime's server plugin
   * resolves create-vs-resume when the first prompt arrives, so loading is the
   * same call as creating — the difference is only whether a persisted log
   * exists, which the plugin checks for us.
   */
  async loadSession(sessionId: string, _opts?: { cwd?: string; mcpServers?: McpServer[] }): Promise<string> {
    this.sessionId = sessionId
    return sessionId
  }

  registerHandler(sessionId: string, handler: AcpSessionHandler): void {
    this.sessionId = sessionId
    this.handler = handler
  }

  unregisterHandler(_sessionId: string): void {
    this.handler = undefined
  }

  /** MCP servers are composed into the runtime's config, so they are up with it. */
  async waitForMcpReady(_timeoutMs?: number): Promise<void> {}

  async prompt(
    sessionId: string,
    text: string,
    images?: ChatImageAttachment[],
  ): Promise<PromptResponse> {
    if (!this.started || this.destroyed) throw new Error('dsh bridge not started')
    if (this.sessionId !== undefined && this.sessionId !== sessionId) {
      // One bridge serves one session; a mismatch means the caller crossed
      // wires, and prompting anyway would append to the wrong transcript.
      throw new Error(`dsh bridge serves session ${this.sessionId}, refusing prompt for ${sessionId}`)
    }

    let promptText = text
    if (images?.length) {
      const written = writeInputAttachments(images, {
        workspaceDir: this.options.cwd,
        sessionId,
      })
      if (written.length > 0) promptText = `${text}\n\n${formatAttachmentNote(written)}`
    }

    const turn = createTurnAccumulator()
    const translator = new DshEventTranslator(turn)
    this.cancelRequested = false

    try {
      const runtime = await this.ensureRuntime(sessionId)
      await runtime.runTurn(sessionId, promptText, (notification) => {
        const updates =
          notification.method === 'session.event'
            ? translator.translate(notification.params.event)
            : notification.method === 'session.stream'
              ? translator.translateStream(notification.params.frame)
              : []
        for (const update of updates) this.emit(update)
      })
    } catch (error) {
      if (this.destroyed || this.cancelRequested) return { stopReason: 'cancelled' } as PromptResponse
      // A runtime that died mid-turn is gone; the next prompt spawns a fresh
      // one, which resumes the session from its log.
      if (error instanceof DshRuntimeDiedError) await this.closeRuntime()
      throw error
    }

    return {
      stopReason: stopReasonOf(turn.end?.kind),
      usage: {
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cachedReadTokens: turn.cacheReadTokens,
        cachedWriteTokens: 0,
      },
    } as unknown as PromptResponse
  }

  /**
   * Abort the active turn; the in-flight prompt settles as cancelled and the
   * runtime keeps serving the session. A runtime that cannot take the request
   * is ended instead — the session survives on disk, and the next prompt's
   * runtime resumes it.
   */
  async cancel(sessionId: string): Promise<void> {
    const runtime = this.runtime
    if (runtime === undefined) return
    this.cancelRequested = true
    try {
      await runtime.cancel(sessionId)
    } catch (error) {
      console.warn(`[dsh-bridge] cancel failed, ending the runtime: ${(error as Error).message}`)
      await this.closeRuntime()
    }
  }

  isAlive(): boolean {
    return this.started && !this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.handler = undefined
    void this.closeRuntime()
  }

  private async closeRuntime(): Promise<void> {
    const runtime = this.runtime
    if (runtime === undefined) return
    this.runtime = undefined
    try {
      await runtime.close()
    } catch (error) {
      console.warn(`[dsh-bridge] close failed: ${(error as Error).message}`)
    }
  }

  private emit(update: SessionUpdate): void {
    try {
      this.handler?.onUpdate(update)
    } catch (error) {
      console.error(`[dsh-bridge] handler threw on ${update.sessionUpdate}:`, error)
    }
  }
}

/** dsh turn reasons → the ACP stop reasons the server skeleton branches on. */
function stopReasonOf(kind: string | undefined): string {
  switch (kind) {
    case 'aborted':
      return 'cancelled'
    case 'max-tokens':
      return 'max_tokens'
    case 'error':
    case 'blocked':
      return 'refusal'
    default:
      return 'end_turn'
  }
}
