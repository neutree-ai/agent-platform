import { REGISTRY } from './registry'
import type { TitleGenProvider } from './types'

export { REGISTRY } from './registry'
export type { TitleGenProviderModule } from './registry'
export type { TitleGenChatInput, TitleGenProvider } from './types'

const MAX_TITLE_LEN = 60
const MAX_INPUT_LEN = 2000

const SYSTEM_PROMPT = [
  "You generate a short title for a chat session from the user's first message.",
  'Rules:',
  '- Output the title text ONLY: no quotes, no trailing punctuation, no prefix like "Title:", and no emoji, checkmarks, or symbols.',
  '- Keep it under 8 words. Use the same language as the message.',
  '- Use ONLY information explicitly present in the message. Never invent project names, IDs, status, or conclusions that are not written there.',
  '- Maximize distinctiveness. Many messages follow the same template (e.g. "check job X", "check the Slack message", "translate file Y"); a generic title like "check job" would collide with dozens of others. Surface the concrete identifier that makes THIS one different — the specific job id, Slack channel/message id, file name, ticket, or branch — and put it in the title.',
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
