import { getSettings } from '../db/system-settings'
import { REGISTRY } from './registry'
import type { AsrProvider } from './types'

export { transcodeToWav16kMono } from './transcode'
export { REGISTRY } from './registry'

export class AsrNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsrNotConfiguredError'
  }
}

export async function getActiveAsrProvider(): Promise<AsrProvider> {
  const { asr_active_provider, asr_providers } = await getSettings()
  if (!asr_active_provider) {
    throw new AsrNotConfiguredError('no active ASR provider configured')
  }
  const mod = REGISTRY[asr_active_provider]
  if (!mod) {
    throw new AsrNotConfiguredError(`unknown ASR provider: ${asr_active_provider}`)
  }
  const rawConfig = asr_providers[asr_active_provider] ?? {}
  const config = mod.configSchema.parse(rawConfig)
  return mod.create(config)
}
