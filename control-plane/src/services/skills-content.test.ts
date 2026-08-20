import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scsDeleteSource, scsListDraftTree, scsSyncSource } from './skills-content'

/** Shape Node produces: the errno sits on `cause`, under `TypeError: fetch failed`. */
const transportError = (code: string) =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(code.toLowerCase()), { code }),
  })

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

/** Drains the retry backoff so a call under fake timers can settle. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return promise
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scs transport retry', () => {
  it('retries an idempotent GET past a dropped connection', async () => {
    fetchMock
      .mockRejectedValueOnce(transportError('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ entries: [] }))

    const result = await settle(scsListDraftTree('src-1'))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: true, value: { entries: [] } })
  })

  it('retries a DELETE, which is idempotent', async () => {
    fetchMock
      .mockRejectedValueOnce(transportError('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const result = await settle(scsDeleteSource('src-1'))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  it('retries a POST when the connection never opened', async () => {
    fetchMock
      .mockRejectedValueOnce(transportError('ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse({ source: {}, results: [], skipped: [] }))

    const result = await settle(scsSyncSource('src-1', { published_by: 'u1' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  it('leaves a POST that died in flight failed, so no version is created twice', async () => {
    fetchMock.mockRejectedValue(transportError('ECONNRESET'))

    const result = await settle(scsSyncSource('src-1', { published_by: 'u1' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'skills-content-service unavailable (ECONNRESET)',
    })
  })

  it('gives up after three attempts and names the errno', async () => {
    fetchMock.mockRejectedValue(transportError('EAI_AGAIN'))

    const result = await settle(scsListDraftTree('src-1'))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'skills-content-service unavailable (EAI_AGAIN)',
    })
  })

  it('does not retry once the caller has aborted', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(() => {
      controller.abort()
      return Promise.reject(transportError('ECONNRESET'))
    })

    const result = await settle(scsListDraftTree('src-1', controller.signal))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, status: 499, error: 'Client disconnected' })
  })

  it('passes an upstream error status through untouched', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'source not found' }, 404))

    const result = await settle(scsSyncSource('src-1', { published_by: 'u1' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, status: 404, error: 'source not found' })
  })
})
