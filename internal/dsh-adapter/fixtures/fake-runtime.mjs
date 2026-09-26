// A stand-in for a dsh runtime, speaking the SDK wire over stdio. `FAKE_MODE`
// picks the behaviour under test; see dsh-runtime.test.ts.
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'

const mode = process.env.FAKE_MODE ?? 'normal'
let prompts = 0
const t = new JsonRpcLineTransport(process.stdin, process.stdout)
const event = (sessionId, type, data = {}) => t.notify('session.event', { sessionId, event: { type, seq: 0, time: 0, data } })
const status = (sessionId, value) => t.notify('session.status', { sessionId, status: value })

t.onRequest(async (method, params) => {
  switch (method) {
    case 'initialize':
      return { serverInfo: { name: 'fake', version: '0' } }
    case 'session/prompt': {
      const sid = params.sessionId
      const messageId = 'm-1'
      // Leftovers from earlier activity and another session's traffic: neither
      // belongs to this turn.
      event(sid, 'turn/end', { reason: { kind: 'completed' } })
      status(sid, 'idle')
      status('other-session', 'idle')
      // The admission can arrive before the prompt's own response.
      event(sid, 'agent/inbox/spliced', { inserted: [{ id: messageId }] })
      status(sid, 'running')
      setImmediate(() => {
        if (mode === 'crash') {
          process.stderr.write('boom: provider exploded\n')
          process.exit(3)
        }
        // `hang` leaves only the first turn running, for a cancel to end.
        if (mode === 'hang' && prompts++ === 0) return
        t.notify('session.stream', { sessionId: sid, frame: { type: 'chunk', attemptId: 'a', index: 0, chunk: { type: 'text-delta', index: 0, text: 'hi' } } })
        event(sid, 'turn/end', { reason: { kind: 'completed' } })
        status(sid, 'idle')
      })
      return { messageId }
    }
    case 'session/cancel':
      event(params.sessionId, 'turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
      status(params.sessionId, 'idle')
      return { cancelled: true }
    case 'shutdown':
      setImmediate(() => process.exit(0))
      return {}
    default:
      throw new Error(`unknown method ${method}`)
  }
})
t.start()
