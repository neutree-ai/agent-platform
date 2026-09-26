import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DshRuntime, DshRuntimeDiedError } from './dsh-runtime.js'
import type { DshNotification } from './types.js'

const FAKE = join(import.meta.dirname, 'fixtures', 'fake-runtime.mjs')

function fakeRuntime(mode: string): DshRuntime {
  return new DshRuntime(
    {
      command: process.execPath,
      args: [FAKE],
      env: { ...(process.env as Record<string, string>), FAKE_MODE: mode },
      provider: 'platform',
      model: 'm',
    },
    import.meta.dirname,
  )
}

function describeNotification(n: DshNotification): string {
  switch (n.method) {
    case 'session.event':
      return `event:${n.params.event.type}`
    case 'session.stream':
      return `stream:${n.params.frame.type}`
    case 'session.status':
      return `status:${n.params.status}`
  }
}

describe('DshRuntime', () => {
  it('delivers the turn from its admission to the next idle, and nothing else', async () => {
    const runtime = fakeRuntime('normal')
    await runtime.start()
    const seen: string[] = []
    await runtime.runTurn('s-1', 'hello', n => seen.push(describeNotification(n)))
    // The stale turn/end and idle ahead of the admission, and the other
    // session's status, are not this turn's.
    expect(seen).toEqual([
      'event:agent/inbox/spliced',
      'status:running',
      'stream:chunk',
      'event:turn/end',
      'status:idle',
    ])
    await runtime.close()
  })

  it('settles a cancelled turn without ending the runtime', async () => {
    const runtime = fakeRuntime('hang')
    await runtime.start()
    const seen: string[] = []
    const turn = runtime.runTurn('s-1', 'hello', n => seen.push(describeNotification(n)))
    await new Promise(resolve => setTimeout(resolve, 50))
    await runtime.cancel('s-1')
    await turn
    expect(seen.at(-2)).toBe('event:turn/end')
    // Still serving: a second turn runs on the same process.
    await runtime.runTurn('s-1', 'again', () => {})
    await runtime.close()
  })

  it('fails the turn, with the runtime stderr, when the process dies mid-turn', async () => {
    const runtime = fakeRuntime('crash')
    await runtime.start()
    const turn = runtime.runTurn('s-1', 'hello', () => {})
    await expect(turn).rejects.toBeInstanceOf(DshRuntimeDiedError)
    await expect(turn).rejects.toThrow(/exit code 3[\s\S]*provider exploded/)
    await runtime.close()
  })
})
