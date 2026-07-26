import { REGISTRY } from './registry'
import type { TitleGenProvider } from './types'

export { REGISTRY } from './registry'
export type { TitleGenProviderModule } from './registry'
export type { TitleGenChatInput, TitleGenProvider } from './types'

const MAX_TITLE_LEN = 60
const MAX_INPUT_LEN = 2000

const SYSTEM_PROMPT = [
  'Create a short, distinctive title for the actual user request.',
  '',
  'The message may concatenate a long route, template, or tool-configuration preamble with a shorter request. Title only the request. Ignore instructions about tools, skills, default channels or threads, routing, permissions, progress updates, and response formatting. The actual request is often near the end, but identify it by meaning rather than position.',
  '',
  'Preserve one safe business discriminator from the actual request when useful, such as a customer, product, ticket, job name, file, or version. Never copy credentials, tokens, webhook keys, personal/user/channel/thread IDs, hashes, timestamps, local paths, or irrelevant infrastructure values.',
  '',
  "If the request lacks enough context, use a minimal grounded fallback. Return only the title in the user's language, with no quotes, prefix, trailing punctuation, emoji, or extra lines. Maximum display width 40; CJK characters count as 2, others as 1.",
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

/**
 * Collapse whitespace, strip wrapping quotes, drop leaked emoji/symbol/label
 * prefixes the model sometimes adds despite instructions, and clamp length.
 * Note: leading brackets (e.g. "[JA glossary]") are intentionally preserved —
 * only emoji, checkmarks, bullets, and a "Title:" label are stripped.
 */
function sanitizeTitle(raw: string): string {
  let t = raw.trim().replace(/\s+/g, ' ')
  // Drop a leading "Title:" / "标题：" label.
  t = t.replace(/^(title|标题)\s*[:：]\s*/i, '')
  // Drop leading emoji / checkmarks / bullets / arrows (but not brackets/quotes).
  t = t.replace(/^[\s\p{Extended_Pictographic}✅✔☑•·→»>]+/u, '')
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
  // Token budget is a per-provider config concern (config.max_tokens, 0 =
  // unlimited); the caller just supplies the prompt.
  const raw = await provider.chat({ system: SYSTEM_PROMPT, user })
  const title = sanitizeTitle(raw)
  return title || null
}
