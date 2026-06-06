import { i18n } from '@/lib/i18n'

/**
 * Canonical list of all inline-help docs. Each name corresponds to a `.md`
 * file under `./en-US/` and `./zh-CN/`. Adding/renaming a doc requires:
 * 1. Update this union
 * 2. Place files at both `./<locale>/<name>.md`
 * 3. Reference it from a typed switch in one of the `*-docs.ts` modules
 *
 * Keeping the names as a literal-string union makes every `loadDoc(...)`
 * call site grep-friendly and catches typos at compile time.
 */
type InlineDocName =
  | 'agent-config-mcp'
  | 'agent-config-model'
  | 'agent-config-prompt'
  | 'agent-config-resources'
  | 'agent-config-settings-claude-code'
  | 'agent-config-settings-codex'
  | 'agent-config-skills'
  | 'browser-launch'
  | 'command'
  | 'connector-slack'
  | 'connector-webhook'
  | 'connector-webhook-relay'
  | 'connector-wecom'
  | 'credential-env'
  | 'credential-file'
  | 'credential-ssh'
  | 'memory-store'
  | 'oauth-app'
  | 'preferences-about'
  | 'preferences-accounts'
  | 'preferences-appearance'
  | 'preferences-evolution'
  | 'preferences-notifications'
  | 'provider-anthropic'
  | 'provider-anthropic-oauth'
  | 'provider-claude-code-oauth'
  | 'provider-openai'
  | 'route-overview'
  | 'route-slack'
  | 'route-webhook'
  | 'route-wecom'
  | 'sandbox'
  | 'schedule-recurring'
  | 'schedule-one-time'
  | 'service-token'
  | 'skill-git'
  | 'skill-upload'
  | 'tags'
  | 'workspace-settings'

const docs = import.meta.glob('./*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const FALLBACK = 'en-US'

// TODO(2026-05-08): backfill missing en-US/*.md and remove ULTIMATE_FALLBACK.
// Today most `agent-config-*.md` (and several others) only exist under
// zh-CN/, so non-zh users get "" from loadDoc. In DocumentedDialog that
// empty string flips `hasDocs` between false (1 empty section → empty
// join) and true (≥2 empty sections → just the "\n\n---\n\n" separator),
// which makes the dialog's column layout flicker — Safari fires a scroll
// event on every resulting resize, the scroll-synced `visibleSections`
// recomputes, hasDocs flips again, infinite loop. Falling back from en-US
// to zh-CN keeps docs non-empty and stable until en-US files land.
const ULTIMATE_FALLBACK = 'zh-CN'

export function loadDoc(name: InlineDocName): string {
  const lang = i18n.language || FALLBACK
  return (
    docs[`./${lang}/${name}.md`] ??
    docs[`./${FALLBACK}/${name}.md`] ??
    docs[`./${ULTIMATE_FALLBACK}/${name}.md`] ??
    ''
  )
}
