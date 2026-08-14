/**
 * Bridge to a DeepSeek Harness runtime, driven over the SDK's stdio JSON-RPC.
 *
 * Implements the same `AgentBridge` contract the ACP bridge does, so the shared
 * server skeleton — SSE sinks, reconnect, LRU eviction, config reload — serves
 * dsh unchanged. Everything dsh-specific is confined to this file and
 * `dsh-events.ts`.
 *
 * Three things differ from an ACP agent and shape the design:
 *
 *  - **Sessions are implicit.** dsh has no create/load call; a prompt names its
 *    session and the runtime creates or resumes it. `createSession`/
 *    `loadSession` therefore only fix the id this bridge serves.
 *  - **There is no cancel on the wire.** Abandoning a turn means ending the
 *    runtime process, which is safe here because one process serves exactly one
 *    session, and lossless because the patched server plugin resumes the
 *    session from its persisted log on the next prompt.
 *  - **MCP servers are composed, not negotiated.** They come from the generated
 *    cordis config the runtime boots with, so the MCP arguments are ignored and
 *    readiness is settled before the first prompt.
 */

import type { McpServer, PromptResponse, SessionUpdate } from '@agentclientprotocol/sdk'
import type { ChatImageAttachment } from '../types/events.js'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { formatAttachmentNote, writeInputAttachments } from '../types/attachments.js'
import type { AcpSessionHandler } from '../acp-adapter/acp-bridge.js'
import { createTurnAccumulator, DshEventTranslator } from './dsh-events.js'
import type { DshSessionEvent } from './types.js'

/** Everything needed to spawn one runtime, resolved at launch time. */
export interface DshLaunchSpec {
  /** Runtime executable and arguments — `dsh-jsonrpc-agent`, or node + its bin. */
  command: string
  args: string[]
  /** Complete child environment, including `DSH_CORDIS_CONFIG`. */
  env: Record<string, string>
  provider: string
  model: string
  maxTokens?: number
}

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
  /** Bounds one model turn, mirroring the ACP bridge's prompt timeout. */
  requestTimeoutMs?: number
}

/** Thrown when the runtime dies while a prompt is in flight and no cancel asked for it. */
export class DshRuntimeDiedError extends Error {
  constructor(message: string) {
    super(`dsh runtime exited unexpectedly: ${message}`)
    this.name = 'DshRuntimeDiedError'
  }
}

export class DshBridge {
  private harness: DeepSeekHarness | undefined
  private handler: AcpSessionHandler | undefined
  private sessionId: string | undefined
  private destroyed = false
  /** Set by `cancel`, read by the in-flight prompt so a kill reads as cancellation. */
  private cancelling = false
  private started = false

  constructor(private readonly options: DshBridgeOptions) {}

  /** No process yet — see `resolveLaunch`. Marks the bridge usable. */
  async start(): Promise<void> {
    if (this.destroyed) throw new Error('dsh bridge destroyed')
    this.started = true
  }

  /** Spawn the runtime and complete the handshake, once per bridge. */
  private async ensureHarness(sessionId: string): Promise<DeepSeekHarness> {
    if (this.harness !== undefined) return this.harness
    const spec = await this.options.resolveLaunch(sessionId)
    const harness = new DeepSeekHarness({
      launch: {
        command: spec.command,
        args: spec.args,
        cwd: this.options.cwd,
        env: spec.env,
        ...(this.options.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: this.options.requestTimeoutMs }),
      },
      cwd: this.options.cwd,
      provider: spec.provider,
      model: spec.model,
      ...(spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens }),
    })
    await harness.start()
    this.harness = harness
    return harness
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
   * Bind this bridge to an existing session. The runtime resolves
   * create-vs-resume itself when the first prompt arrives, so loading is the
   * same call as creating — the difference is only whether a persisted log
   * exists, which the runtime checks for us.
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

    try {
      const harness = await this.ensureHarness(sessionId)
      await harness.run(promptText, {
        sessionId,
        onNotification: (notification: unknown) => {
          const note = notification as { method?: string; params?: { event?: DshSessionEvent } }
          if (note.method !== 'session.event') return
          const event = note.params?.event
          if (event === undefined) return
          for (const update of translator.translate(event)) this.emit(update)
        },
      })
    } catch (error) {
      // A cancel kills the runtime under the in-flight prompt; that rejection is
      // the expected shape of "the user stopped this turn", not a failure.
      if (this.cancelling || this.destroyed) {
        return { stopReason: 'cancelled' } as PromptResponse
      }
      throw new DshRuntimeDiedError((error as Error).message)
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
   * End the turn by ending the runtime. The session survives on disk; the next
   * prompt spawns a fresh bridge that resumes it.
   */
  async cancel(_sessionId: string): Promise<void> {
    this.cancelling = true
    await this.closeHarness()
  }

  isAlive(): boolean {
    return this.started && !this.destroyed && !this.cancelling
  }

  destroy(): void {
    this.destroyed = true
    this.handler = undefined
    void this.closeHarness()
  }

  private async closeHarness(): Promise<void> {
    const harness = this.harness
    if (harness === undefined) return
    this.harness = undefined
    this.started = false
    try {
      await harness.close()
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
    case 'interrupted':
      return 'cancelled'
    case 'max-tokens':
      return 'max_tokens'
    case 'error':
      return 'refusal'
    default:
      return 'end_turn'
  }
}
