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
  | 'agent-config-settings-goose'
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
  | 'provider-openai-chat'
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

export function loadDoc(name: InlineDocName): string {
  const lang = i18n.language || FALLBACK
  return docs[`./${lang}/${name}.md`] ?? docs[`./${FALLBACK}/${name}.md`] ?? ''
}
