/**
 * One DeepSeek Harness runtime process, driven over the SDK's stdio JSON-RPC.
 *
 * `@deepseek-ai/dsh-sdk-client` would do this, but it depends on the whole
 * `dsh` CLI distribution to launch a named profile, while this adapter boots
 * its own composition. The wire itself is small — `initialize`,
 * `session/prompt`, `shutdown`, plus the platform server plugin's
 * `session/cancel` — so the client is spoken directly over the protocol
 * package's transport.
 *
 * A turn is asynchronous on this wire: `session/prompt` answers once the
 * message is queued, with its id. The turn is the session's activity from the
 * log event that admits that message until the agent next reports `idle`.
 */

import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { DshNotification } from './types.js'

/** Everything needed to spawn one runtime, resolved at launch time. */
export interface DshLaunchSpec {
  /** Runtime executable and arguments. */
  command: string
  args: string[]
  /** Complete child environment. */
  env: Record<string, string>
  provider: string
  model: string
  maxTokens?: number
}

/** Thrown when the runtime dies while a turn is in flight. */
export class DshRuntimeDiedError extends Error {
  constructor(message: string) {
    super(`dsh runtime exited unexpectedly: ${message}`)
    this.name = 'DshRuntimeDiedError'
  }
}

const INITIALIZE_TIMEOUT_MS = 60_000
const SHUTDOWN_TIMEOUT_MS = 5_000
/** A cancel only flips the agent's abort signal; a runtime slower than this is wedged. */
const CANCEL_TIMEOUT_MS = 10_000
/** Enough stderr to explain a crash without holding a chatty runtime's whole log. */
const STDERR_TAIL_BYTES = 4_096

type Listener = (notification: DshNotification) => void

export class DshRuntime {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | undefined
  private transport: JsonRpcLineTransport | undefined
  private readonly listeners = new Set<Listener>()
  private stderrTail = ''
  private exited: Promise<string> | undefined
  private hasExited = false

  constructor(
    private readonly spec: DshLaunchSpec,
    private readonly cwd: string,
  ) {}

  /** Spawn the runtime and complete the handshake. */
  async start(): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.cwd,
      env: this.spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
    })
    this.exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve(signal ? `signal ${signal}` : `exit code ${code}`))
      child.once('error', (error) => resolve(error.message))
    })
    void this.exited.then(() => {
      this.hasExited = true
    })

    const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    this.transport = transport
    transport.onNotification((method, params) => {
      // subagent.* notifications carry no `sessionId` and fall through every filter.
      const notification = { method, params } as unknown as DshNotification
      for (const listener of this.listeners) listener(notification)
    })
    transport.start()

    await this.untilExit(
      withTimeout(
        transport.request('initialize', {
          cwd: this.cwd,
          provider: this.spec.provider,
          model: this.spec.model,
          ...(this.spec.maxTokens === undefined ? {} : { maxTokens: this.spec.maxTokens }),
        }),
        INITIALIZE_TIMEOUT_MS,
        'dsh runtime initialize',
      ),
    )
  }

  /**
   * Queue one prompt and settle when the turn it started is over. Notifications
   * for this session are handed to `onNotification` from the moment the
   * message is admitted; earlier ones belong to activity this prompt did not
   * start.
   */
  async runTurn(
    sessionId: string,
    text: string,
    onNotification: (notification: DshNotification) => void,
  ): Promise<void> {
    const transport = this.requireTransport()
    let messageId: string | undefined
    let admitted = false
    const early: DshNotification[] = []
    let settle!: () => void
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })

    const deliver = (notification: DshNotification): void => {
      if (!admitted) {
        if (!admits(notification, messageId)) return
        admitted = true
      }
      onNotification(notification)
      if (notification.method === 'session.status' && notification.params.status === 'idle') settle()
    }
    const listener: Listener = (notification) => {
      if (notification.params.sessionId !== sessionId) return
      // The admission event can race the prompt's own response.
      if (messageId === undefined) early.push(notification)
      else deliver(notification)
    }

    this.listeners.add(listener)
    try {
      const receipt = (await this.untilExit(
        transport.request('session/prompt', {
          sessionId,
          contentBlocks: [{ type: 'text', text }],
        }),
      )) as { messageId?: unknown }
      if (typeof receipt?.messageId !== 'string') {
        throw new Error(`dsh session/prompt returned no message id: ${JSON.stringify(receipt)}`)
      }
      messageId = receipt.messageId
      for (const notification of early.splice(0)) deliver(notification)
      await this.untilExit(done)
    } finally {
      this.listeners.delete(listener)
    }
  }

  /** Abort the session's active turn. The runtime and the session stay up. */
  async cancel(sessionId: string): Promise<void> {
    await withTimeout(
      this.requireTransport().request('session/cancel', { sessionId }),
      CANCEL_TIMEOUT_MS,
      'dsh runtime cancel',
    )
  }

  /** Ask the runtime to shut down, and end the process if it does not. */
  async close(): Promise<void> {
    const child = this.child
    const transport = this.transport
    if (child === undefined || transport === undefined) return
    this.child = undefined
    this.transport = undefined
    if (!this.hasExited) {
      try {
        await withTimeout(transport.request('shutdown', {}), SHUTDOWN_TIMEOUT_MS, 'dsh runtime shutdown')
      } catch {
        // Fall through to the signal: a runtime that cannot answer shutdown is
        // exactly the one that must not be left running.
      }
    }
    transport.close()
    if (!this.hasExited) child.kill('SIGTERM')
  }

  private requireTransport(): JsonRpcLineTransport {
    if (this.transport === undefined) throw new Error('dsh runtime not started')
    return this.transport
  }

  /** Race `task` against the process exiting, so a crash fails the wait instead of hanging it. */
  private untilExit<T>(task: Promise<T>): Promise<T> {
    const exited = this.exited
    if (exited === undefined) return task
    return Promise.race([
      task,
      exited.then((how) => {
        const tail = this.stderrTail.trim()
        throw new DshRuntimeDiedError(tail ? `${how}\n${tail}` : how)
      }),
    ])
  }
}

/** Whether a log event is the inbox splice that admits the prompt `messageId`. */
function admits(notification: DshNotification, messageId: string | undefined): boolean {
  if (messageId === undefined || notification.method !== 'session.event') return false
  const { event } = notification.params
  if (event.type !== 'agent/inbox/spliced') return false
  const inserted = event.data?.inserted
  return Array.isArray(inserted) && inserted.some((message) => (message as { id?: unknown })?.id === messageId)
}

function withTimeout<T>(task: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
}
