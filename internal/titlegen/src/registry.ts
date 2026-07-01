import openai from './providers/openai'
import type { TitleGenProvider } from './types'

/**
 * Minimal validator shape a provider config exposes. Kept dependency-free (no
 * zod) so this shared package pulls in no external npm — matching the other
 * internal/* packages — while still matching the `safeParse` interface the
 * control-plane admin route validates against.
 */
export interface ConfigSchema<C> {
  safeParse(v: unknown): { success: true; data: C } | { success: false; error: { issues: unknown } }
}

export interface TitleGenProviderModule<C = unknown> {
  readonly name: string
  readonly configSchema: ConfigSchema<C>
  create(config: C): TitleGenProvider
}

/**
 * Each title-gen provider is a self-contained module under ./providers/<name>.ts
 * exporting `name`, `configSchema`, and `create`. Register here to make it
 * resolvable by `resolveTitleGenProvider`.
 */
export const REGISTRY: Record<string, TitleGenProviderModule> = {
  [openai.name]: openai,
}
