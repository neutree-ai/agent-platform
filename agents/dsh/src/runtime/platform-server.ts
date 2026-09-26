/**
 * The SDK JSON-RPC server plugin, extended for the platform.
 *
 * The stock `@deepseek-ai/dsh-sdk-jsonrpc-server` serves `initialize`,
 * `session/prompt`, and `shutdown`, and forwards the durable session log. Three
 * things the platform needs are missing from it, and each is one step here
 * around the stock server rather than a fork of it:
 *
 *  - **Resume.** The stock server calls `ctx.agents.create()` for any session
 *    id it has not served in this process, so a restarted runtime would fail
 *    the next prompt with an id collision and lose the conversation. The
 *    harness can resume — `ctx.agents.resume()`, including crash repair for a
 *    turn interrupted mid-flight — so on a prompt for an unserved id that
 *    persistence knows, resume it and hand the agent to the stock server.
 *  - **Token streaming.** Text and reasoning deltas are published only as the
 *    process-local `agent/assistant-stream` event, never into the log, so they
 *    are forwarded as `session.stream` notifications.
 *  - **Cancel.** `session/cancel` aborts the session's active turn through
 *    `agent.cancel()`. The turn ends as `aborted` and the agent keeps serving.
 *
 * Event fan-out, subagent notifications, and the shutdown ladder stay the
 * stock implementation.
 */

import type { Readable, Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import Schema from '@deepseek-ai/schemastery'

export const name = 'sdk-jsonrpc-server-platform'
export const inject = ['agents', 'sessionPersistence']

export interface PlatformJsonRpcConfig {
  maxTokensAsSuccess?: boolean
  input?: Readable
  output?: Writable
  exit?: (code: number) => void
}

export const Config: Schema<PlatformJsonRpcConfig> = Schema.object({
  maxTokensAsSuccess: Schema.boolean().default(false),
})

/** The slice of a live agent this plugin touches. */
interface LiveAgent {
  session: { id: unknown }
  cancel(cause: { kind: 'user' }): void
}

interface AgentHandle {
  agent: LiveAgent
}

/**
 * The harness services and event this plugin uses.
 *
 * dsh publishes these by augmenting cordis's `Context`, but an augmentation
 * only reaches the copy of cordis its own package resolves, and the agent image
 * installs more than one. Declaring them locally keeps the plugin honest about
 * its surface and independent of how the tree happens to hoist.
 */
interface HarnessServices {
  agents: {
    resume(options: {
      resumeSessionId: unknown
      agentOptions?: { provider: string; model: string; maxTokens?: number }
    }): Promise<AgentHandle>
  }
  sessionPersistence: {
    stat(id: unknown): Promise<unknown | undefined>
  }
  on(
    event: 'agent/assistant-stream',
    listener: (payload: { agent: LiveAgent; frame: unknown }) => void,
  ): () => void
}

/** The stock server's private session table — the one internal we depend on. */
interface ServerInternals {
  sessions: Map<string, { handle: AgentHandle }>
}

/** Route facts from the SDK handshake, mirrored so a resumed agent matches a created one. */
interface RouteFacts {
  provider: string
  model: string
  maxTokens?: number
}

export function apply(ctx: Context & HarnessServices, config: PlatformJsonRpcConfig): void {
  const resolved = config as PlatformJsonRpcConfig & { maxTokensAsSuccess: boolean }
  const rootFiber = ctx.root.fiber
  const input = config.input ?? process.stdin
  const output = config.output ?? process.stdout
  const exit =
    config.exit ??
    ((code: number): void => {
      process.exit(code)
    })

  const transport = new JsonRpcLineTransport(input, output)
  const server = new HarnessSdkJsonRpcServer(ctx, transport, {
    maxTokensAsSuccess: resolved.maxTokensAsSuccess,
  })

  // Fail at boot rather than mid-turn if the field this plugin reaches into is
  // gone: the whole point is that ending a runtime must not lose the session.
  const internals = server as unknown as ServerInternals
  if (!(internals.sessions instanceof Map)) {
    throw new Error(
      'dsh-platform-server: HarnessSdkJsonRpcServer no longer exposes a `sessions` Map; ' +
        'the resume hook needs updating for this dsh version',
    )
  }

  let route: RouteFacts | undefined
  const resumptions = new Map<string, Promise<void>>()

  async function resumeIfPersisted(sessionId: string): Promise<void> {
    if (internals.sessions.has(sessionId)) return
    // No handshake yet: let the stock server raise its own protocol error.
    if (route === undefined) return
    // Genuinely new session — the stock create path is the correct one.
    if ((await ctx.sessionPersistence.stat(SessionId(sessionId))) === undefined) return
    const handle = await ctx.agents.resume({
      resumeSessionId: SessionId(sessionId),
      agentOptions: route,
    })
    internals.sessions.set(sessionId, { handle })
  }

  /** One resumption per id, shared by concurrent prompts, retried after failure. */
  function resumeOnce(sessionId: string): Promise<void> {
    let task = resumptions.get(sessionId)
    if (task === undefined) {
      task = resumeIfPersisted(sessionId)
      resumptions.set(sessionId, task)
      void task.catch(() => {
        resumptions.delete(sessionId)
      })
    }
    return task
  }

  function cancel(sessionId: string): { cancelled: boolean } {
    const record = internals.sessions.get(sessionId)
    record?.handle.agent.cancel({ kind: 'user' })
    return { cancelled: record !== undefined }
  }

  const stopStreaming = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    transport.notify('session.stream', { sessionId: String(agent.session.id), frame })
  })

  let exitTask: Promise<void> | undefined
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    const sessionId = String((params as { sessionId?: unknown } | undefined)?.sessionId)
    if (method === 'initialize') {
      // The composition loads asynchronously, so a handshake can arrive before
      // every plugin is up — MCP servers included.
      await ctx.get('loader')?.await()
      const p = params as unknown as RouteFacts
      route = {
        provider: p.provider,
        model: p.model,
        ...(p.maxTokens === undefined ? {} : { maxTokens: p.maxTokens }),
      }
    }
    if (method === 'session/prompt') await resumeOnce(sessionId)
    if (method === 'session/cancel') return cancel(sessionId)
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      setImmediate(() => {
        void disposeAndExit()
      })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      stopStreaming()
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve.platform')
}
