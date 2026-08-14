/**
 * SDK JSON-RPC server plugin with session resume.
 *
 * The stock `@deepseek-ai/dsh-sdk-jsonrpc-server` always calls
 * `ctx.agents.create()` for a session id it has not served, so prompting a
 * session that already has a persisted log fails the turn with an
 * `(id collision)` error and a runtime restart loses the conversation. The
 * harness can resume — `ctx.agents.resume()` over
 * `ctx.sessionPersistence.prepare()`, including crash repair for a turn that
 * was interrupted mid-flight — only this server plugin never reaches for it.
 *
 * That gap matters more here than it would elsewhere: the SDK wire has no
 * cancel, so stopping a turn means ending the runtime process. Without resume,
 * every stop would also discard the session.
 *
 * This plugin keeps the stock server for every protocol method and inserts one
 * step ahead of it: on a prompt for a session this process has not served whose
 * id IS present in persistence, resume the agent and hand the record over
 * before delegating. Event fan-out, subagent notifications, and the shutdown
 * ladder stay the stock implementation.
 */

import type { Readable, Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import Schema from '@deepseek-ai/schemastery'

export const name = 'sdk-jsonrpc-server-resume'
export const inject = ['agents', 'sessionPersistence']

export interface ResumeJsonRpcConfig {
  maxTokensAsSuccess?: boolean
  input?: Readable
  output?: Writable
  exit?: (code: number) => void
}

export const Config: Schema<ResumeJsonRpcConfig> = Schema.object({
  maxTokensAsSuccess: Schema.boolean().default(false),
})

/**
 * The two harness services this plugin calls.
 *
 * dsh publishes these by augmenting cordis's `Context`, but an augmentation
 * only reaches the copy of cordis its own package resolves, and the agent image
 * installs more than one. Declaring the calls locally keeps the plugin honest
 * about its surface and independent of how the tree happens to hoist.
 */
interface HarnessServices {
  agents: {
    resume(options: {
      resumeSessionId: unknown
      agentOptions?: { provider: string; model: string; maxTokens?: number }
    }): Promise<AgentHandle>
  }
  sessionPersistence: {
    list(signal?: AbortSignal): Promise<{ id: unknown }[]>
  }
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

export function apply(ctx: Context & HarnessServices, config: ResumeJsonRpcConfig): void {
  const resolved = config as ResumeJsonRpcConfig & { maxTokensAsSuccess: boolean }
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
      'dsh-resume-server: HarnessSdkJsonRpcServer no longer exposes a `sessions` Map; ' +
        'the resume hook needs updating for this dsh version',
    )
  }

  let route: RouteFacts | undefined
  const resumptions = new Map<string, Promise<void>>()

  async function resumeIfPersisted(sessionId: string): Promise<void> {
    if (internals.sessions.has(sessionId)) return
    // No handshake yet: let the stock server raise its own protocol error.
    if (route === undefined) return
    const headers = await ctx.sessionPersistence.list()
    // Genuinely new session — the stock create path is the correct one.
    if (!headers.some((header) => String(header.id) === sessionId)) return
    const handle = await ctx.agents.resume({
      resumeSessionId: SessionId(sessionId),
      agentOptions: {
        provider: route.provider,
        model: route.model,
        ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
      },
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
    if (method === 'initialize') {
      const p = params as unknown as RouteFacts
      route = {
        provider: p.provider,
        model: p.model,
        ...(p.maxTokens === undefined ? {} : { maxTokens: p.maxTokens }),
      }
    }
    if (method === 'session/prompt') {
      await resumeOnce(String((params as { sessionId?: unknown } | undefined)?.sessionId))
    }
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
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve.resume')
}
