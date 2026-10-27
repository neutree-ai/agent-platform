import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfigAtBoot } from './boot.js'

function exitSpy() {
  return vi.fn((code: number) => {
    throw new Error(`exit ${code}`)
  }) as unknown as ((code: number) => never) & ReturnType<typeof vi.fn>
}

describe('loadConfigAtBoot', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('retries failures and throws until the load succeeds', async () => {
    const loadConfig = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const exit = exitSpy()
    await loadConfigAtBoot(loadConfig, { cpConfigured: true, retryDelayMs: 0, exit })
    expect(loadConfig).toHaveBeenCalledTimes(3)
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits after the last attempt fails', async () => {
    const loadConfig = vi.fn(async () => false)
    const exit = exitSpy()
    await expect(
      loadConfigAtBoot(loadConfig, { cpConfigured: true, maxAttempts: 3, retryDelayMs: 0, exit }),
    ).rejects.toThrow('exit 1')
    expect(loadConfig).toHaveBeenCalledTimes(3)
  })

  it('loads once without retrying when cp is not configured', async () => {
    const loadConfig = vi.fn(async () => false)
    const exit = exitSpy()
    await loadConfigAtBoot(loadConfig, { cpConfigured: false, exit })
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })
})
