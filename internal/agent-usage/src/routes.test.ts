import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { registerUsageRoutes } from './routes.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-usage-routes-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

interface Reply {
  body: unknown
  status: number
}

function mount() {
  let handler: ((c: unknown) => Promise<Reply>) | undefined
  registerUsageRoutes(
    {
      post: (_path, h) => {
        handler = h
      },
    },
    '/usage',
    { homeDir: home },
  )
  if (!handler) throw new Error('route not registered')
  const route = handler
  return () =>
    route({
      req: { json: async () => ({}) },
      json: (body: unknown, status = 200): Reply => ({ body, status }),
    })
}

describe('registerUsageRoutes', () => {
  test('rejects a pull while another sweep is in flight, then accepts the next one', async () => {
    const pull = mount()
    const first = pull()
    const overlapping = await pull()
    expect(overlapping.status).toBe(503)

    expect((await first).status).toBe(200)
    expect((await pull()).status).toBe(200)
  })
})
