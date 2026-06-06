import type { z } from 'zod'
import openai from './providers/openai'
import type { AsrProvider } from './types'

export interface AsrProviderModule<C = unknown> {
  readonly name: string
  readonly configSchema: z.ZodType<C>
  create(config: C): AsrProvider
}

/**
 * Each ASR provider is a self-contained module under ./providers/<name>.ts
 * exporting `name`, `configSchema`, and `create`. Register here to make it
 * resolvable by `getActiveAsrProvider`.
 */
export const REGISTRY: Record<string, AsrProviderModule> = {
  [openai.name]: openai,
}
