import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  claimSessionTurn: vi.fn(),
  adoptSessionTurn: vi.fn(),
  renewSessionTurn: vi.fn(),
  releaseSessionTurn: vi.fn(),
}))
vi.mock('../db/sessions', () => db)

const { adoptSessionTurn, claimSessionTurn } = await import('./session-turn')

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  db.claimSessionTurn.mockResolvedValue(true)
  db.adoptSessionTurn.mockResolvedValue(undefined)
  db.renewSessionTurn.mockResolvedValue(true)
  db.releaseSessionTurn.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
})

async function claimed() {
  const claim = await claimSessionTurn('s1')
  if (!claim) throw new Error('expected a claim')
  return claim
}

describe('session turn claim', () => {
  it('holds nothing when the session is busy', async () => {
    db.claimSessionTurn.mockResolvedValueOnce(false)
    expect(await claimSessionTurn('s1')).toBeNull()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(db.renewSessionTurn).not.toHaveBeenCalled()
  })

  it('renews under its own token, more often than the claim lasts', async () => {
    await claimed()
    const [, token, ttlSeconds] = db.claimSessionTurn.mock.calls[0]

    await vi.advanceTimersByTimeAsync(ttlSeconds * 1000 - 1)

    expect(db.renewSessionTurn.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(db.renewSessionTurn).toHaveBeenCalledWith('s1', token, ttlSeconds)
  })

  it('release frees the session once and stops renewing', async () => {
    const claim = await claimed()

    await claim.release()
    await claim.release()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(db.releaseSessionTurn).toHaveBeenCalledTimes(1)
    expect(db.renewSessionTurn).not.toHaveBeenCalled()
  })

  it('release does not reject when the database fails', async () => {
    db.releaseSessionTurn.mockRejectedValueOnce(new Error('db down'))
    const claim = await claimed()

    await expect(claim.release()).resolves.toBeUndefined()
  })

  it('stops renewing once another holder has taken the claim over', async () => {
    await claimed()
    db.renewSessionTurn.mockResolvedValue(false)

    await vi.advanceTimersByTimeAsync(120_000)

    expect(db.renewSessionTurn).toHaveBeenCalledTimes(1)
  })

  it('adopt takes the claim outright and holds it', async () => {
    const claim = await adoptSessionTurn('s1')
    const token = db.adoptSessionTurn.mock.calls[0][1]

    await vi.advanceTimersByTimeAsync(25_000)
    await claim.release()

    expect(db.renewSessionTurn).toHaveBeenCalledWith('s1', token, expect.any(Number))
    expect(db.releaseSessionTurn).toHaveBeenCalledWith('s1', token)
  })
})
