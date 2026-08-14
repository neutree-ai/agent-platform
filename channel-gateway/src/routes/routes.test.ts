import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv, JwtPayload } from '../lib/types'
import * as db from '../services/db'
import routesApp from './routes'

vi.mock('../services/db', () => ({
  getConnector: vi.fn(),
  createRoute: vi.fn(),
  listRoutes: vi.fn(),
  getRoute: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
}))

const mocked = vi.mocked(db)

function appAs(userId: string) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('user', { sub: userId } as JwtPayload)
    await next()
  })
  app.route('/routes', routesApp)
  return app
}

function post(userId: string, body: Record<string, unknown>) {
  return appAs(userId).request('/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /routes catch-all ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocked.createRoute.mockImplementation(async (data) => ({ id: 'r1', ...data }) as never)
  })

  it('lets the connector owner claim the catch-all', async () => {
    mocked.getConnector.mockResolvedValue({ id: 'c1', user_id: 'owner' } as never)

    const res = await post('owner', {
      connector_id: 'c1',
      external_id: '*',
      workspace_id: 'w1',
    })

    expect(res.status).toBe(201)
    expect(mocked.createRoute).toHaveBeenCalled()
  })

  it('rejects the catch-all on a connector owned by someone else', async () => {
    mocked.getConnector.mockResolvedValue({ id: 'c1', user_id: 'owner' } as never)

    const res = await post('borrower', {
      connector_id: 'c1',
      external_id: '*',
      workspace_id: 'w1',
    })

    expect(res.status).toBe(403)
    expect(mocked.createRoute).not.toHaveBeenCalled()
  })

  it('still lets a borrower route a specific channel', async () => {
    mocked.getConnector.mockResolvedValue({ id: 'c1', user_id: 'owner' } as never)

    const res = await post('borrower', {
      connector_id: 'c1',
      external_id: 'C0123456789',
      workspace_id: 'w1',
    })

    expect(res.status).toBe(201)
    expect(mocked.createRoute).toHaveBeenCalled()
  })
})
