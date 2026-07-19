import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCreateBodySchema } from '../../../internal/types/api'

// Built-in advertises multiReplica when cp is deployed with a RWX storage class.
// Set it before the module (and its defaultCfg) evaluate, via top-level await
// import so the built-in gate reads `true`.
process.env.WORKSPACE_MULTI_REPLICA = 'true'

const { getEnvironmentForUserMock } = vi.hoisted(() => ({
  getEnvironmentForUserMock: vi.fn(),
}))
vi.mock('./db/environments', () => ({ getEnvironmentForUser: getEnvironmentForUserMock }))

const { chooseEnvironment } = await import('./placement-decision')

const env = (over: Record<string, unknown>) =>
  ({ id: 'e1', name: 'Remote', is_builtin: false, status: 'online', ...over }) as any

beforeEach(() => vi.clearAllMocks())

describe('chooseEnvironment — auto-scaling capability gate', () => {
  it('allows auto-scaling on built-in when cp advertises multiReplica', async () => {
    getEnvironmentForUserMock.mockResolvedValue(env({ id: 'builtin', is_builtin: true }))
    const d = await chooseEnvironment({
      userId: 'u1',
      isSystem: false,
      required: { multiReplica: true },
    })
    expect(d.ok).toBe(true)
  })

  it('allows auto-scaling on a remote env that advertises multiReplica', async () => {
    getEnvironmentForUserMock.mockResolvedValue(env({ capabilities: { multiReplica: true } }))
    const d = await chooseEnvironment({
      userId: 'u1',
      isSystem: false,
      requestedEnvironmentId: 'e1',
      required: { multiReplica: true },
    })
    expect(d.ok).toBe(true)
  })

  it('rejects auto-scaling on a remote env that does not advertise multiReplica', async () => {
    getEnvironmentForUserMock.mockResolvedValue(env({ capabilities: {} }))
    const d = await chooseEnvironment({
      userId: 'u1',
      isSystem: false,
      requestedEnvironmentId: 'e1',
      required: { multiReplica: true },
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.error).toMatch(/auto-scaling/)
  })

  it('a static workspace (no multiReplica required) places on any online env', async () => {
    getEnvironmentForUserMock.mockResolvedValue(env({ capabilities: {} }))
    const d = await chooseEnvironment({
      userId: 'u1',
      isSystem: false,
      requestedEnvironmentId: 'e1',
      required: {},
    })
    expect(d.ok).toBe(true)
  })
})

describe('WorkspaceCreateBodySchema — auto_scaling validation', () => {
  it('accepts a valid auto_scaling block', () => {
    const r = WorkspaceCreateBodySchema.safeParse({
      name: 'w',
      auto_scaling: { min_replicas: 0, max_replicas: 3, scale_to_zero_idle_seconds: 300 },
    })
    expect(r.success).toBe(true)
  })

  it('rejects min_replicas > max_replicas', () => {
    const r = WorkspaceCreateBodySchema.safeParse({
      name: 'w',
      auto_scaling: { min_replicas: 4, max_replicas: 2 },
    })
    expect(r.success).toBe(false)
  })

  it('rejects max_replicas < 1', () => {
    const r = WorkspaceCreateBodySchema.safeParse({
      name: 'w',
      auto_scaling: { min_replicas: 0, max_replicas: 0 },
    })
    expect(r.success).toBe(false)
  })

  it('omitting auto_scaling is valid (static workspace)', () => {
    expect(WorkspaceCreateBodySchema.safeParse({ name: 'w' }).success).toBe(true)
  })
})
