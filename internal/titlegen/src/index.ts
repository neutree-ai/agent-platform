import { REGISTRY } from './registry'
import type { TitleGenProvider } from './types'

export { REGISTRY } from './registry'
export type { TitleGenProviderModule } from './registry'
export type { TitleGenChatInput, TitleGenProvider } from './types'

const MAX_TITLE_LEN = 60
const MAX_INPUT_LEN = 2000

const SYSTEM_PROMPT = [
  "You generate a short title for a chat session based on the user's first message.",
  'Rules:',
  '- Reply with the title text only — no quotes, no punctuation at the ends, no prefix like "Title:".',
  '- Keep it under 8 words. Be concise and specific.',
  "- Use the same language as the user's message.",
].join('\n')

/**
 * Resolve a title-gen provider from stored system settings, or null when the
 * feature is not usable (no active provider, unknown provider name, or invalid
 * stored config). Pure — no DB access — so callers inject their own settings.
 * Consumers use this so a mis- or un-configured feature is a no-op rather than
 * a crash.
 */
export function resolveTitleGenProvider(
  activeProvider: string | null,
  providers: Record<string, unknown>,
): TitleGenProvider | null {
  if (!activeProvider) return null
  const mod = REGISTRY[activeProvider]
  if (!mod) return null
  const parsed = mod.configSchema.safeParse(providers[activeProvider] ?? {})
  if (!parsed.success) return null
  return mod.create(parsed.data)
}

/** Collapse whitespace, strip wrapping quotes, and clamp length. */
function sanitizeTitle(raw: string): string {
  let t = raw.trim().replace(/\s+/g, ' ')
  // Models sometimes wrap the title in quotes despite instructions.
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (t.length > MAX_TITLE_LEN) t = t.slice(0, MAX_TITLE_LEN).trim()
  return t
}

/**
 * Generate a session title from its first user message using the given
 * provider. Returns the sanitized title, or null if the model produced nothing
 * usable.
 */
export async function generateTitle(
  provider: TitleGenProvider,
  firstUserMessage: string,
): Promise<string | null> {
  const user = firstUserMessage.slice(0, MAX_INPUT_LEN)
  const raw = await provider.chat({ system: SYSTEM_PROMPT, user, maxTokens: 32 })
  const title = sanitizeTitle(raw)
  return title || null
}
