import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/workspace-address', () => ({ notifyAgentReload: vi.fn() }))
vi.mock('../../services/skills-composition', () => ({
  skillRepo: { listWorkspacesUsingSkill: vi.fn() },
}))

import { notifyAgentReload } from '../../lib/workspace-address'
import { skillRepo } from '../../services/skills-composition'
import svc from './index'

const usingSkill = vi.mocked(skillRepo.listWorkspacesUsingSkill)
const reload = vi.mocked(notifyAgentReload)
const originalKey = process.env.SERVICE_KEY

function post(path: string, key?: string) {
  return svc.request(path, {
    method: 'POST',
    headers: key ? { 'X-Service-Key': key } : undefined,
  })
}

beforeEach(() => {
  process.env.SERVICE_KEY = 'svc-secret'
  usingSkill.mockReset()
  reload.mockReset()
  usingSkill.mockResolvedValue([{ id: 'ws1' }, { id: 'ws2' }] as never)
  reload.mockResolvedValue(true as never)
})

afterEach(() => {
  // delete, not `= undefined`: Node stores that assignment as the string
  // "undefined", which would look like a configured key to the middleware.
  // biome-ignore lint/performance/noDelete: the variable must actually be gone
  if (originalKey === undefined) delete process.env.SERVICE_KEY
  else process.env.SERVICE_KEY = originalKey
})

describe('POST /svc/v1/skills/:id/reload-fanout', () => {
  it('fans the reload out to every workspace using the skill', async () => {
    const res = await post('/v1/skills/sk-1/reload-fanout', 'svc-secret')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 2, notified: 2, failed: 0 })
  })

  it('counts failures so the caller can retry the job', async () => {
    reload.mockResolvedValueOnce(true as never).mockResolvedValueOnce(false as never)

    const res = await post('/v1/skills/sk-1/reload-fanout', 'svc-secret')

    expect(await res.json()).toMatchObject({ notified: 1, failed: 1 })
  })

  it('rejects a request with no key', async () => {
    const res = await post('/v1/skills/sk-1/reload-fanout')

    expect(res.status).toBe(401)
    expect(usingSkill).not.toHaveBeenCalled()
  })

  it('rejects a wrong key', async () => {
    const res = await post('/v1/skills/sk-1/reload-fanout', 'not-it')

    expect(res.status).toBe(401)
    expect(usingSkill).not.toHaveBeenCalled()
  })

  // Fails closed: a deployment that forgets the variable breaks loudly here
  // rather than quietly serving an open endpoint.
  it('rejects everything when the key is not configured', async () => {
    // biome-ignore lint/performance/noDelete: the variable must actually be gone
    delete process.env.SERVICE_KEY
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await post('/v1/skills/sk-1/reload-fanout', 'svc-secret')

    expect(res.status).toBe(401)
    expect(usingSkill).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
