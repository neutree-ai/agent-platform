import { i18n } from '@/lib/i18n'

/**
 * Built-in prompt presets per connector type. Each `.md` file under
 * `./<locale>/<connector>/<slug>.md` has frontmatter with `name: <label>`
 * and body containing the template. Presets are capability demos — they
 * show which variables are available and how to position them — not
 * business templates for any specific workflow.
 */
export type ConnectorType = 'slack' | 'wecom' | 'webhook'

type PromptPreset = {
  id: string
  name: string
  body: string
}

const files = import.meta.glob('./*/*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const FALLBACK = 'en-US'

function parsePreset(raw: string): { name: string; body: string } {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!fm) return { name: '', body: raw.trim() }
  const nameMatch = fm[1].match(/^name:\s*(.+)$/m)
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : ''
  return { name, body: fm[2].trim() }
}

function collect(locale: string, connector: ConnectorType): PromptPreset[] {
  const presets: PromptPreset[] = []
  for (const [path, raw] of Object.entries(files)) {
    // path like "./zh-CN/slack/with-sender.md"
    const m = path.match(/^\.\/([^/]+)\/([^/]+)\/([^/]+)\.md$/)
    if (!m) continue
    const [, loc, conn, slug] = m
    if (loc !== locale || conn !== connector) continue
    const parsed = parsePreset(raw)
    presets.push({ id: slug, name: parsed.name || slug, body: parsed.body })
  }
  return presets.sort((a, b) => a.id.localeCompare(b.id))
}

export function listPromptPresets(connector: ConnectorType): PromptPreset[] {
  const lang = i18n.language || FALLBACK
  const primary = collect(lang, connector)
  if (primary.length) return primary
  return collect(FALLBACK, connector)
}
