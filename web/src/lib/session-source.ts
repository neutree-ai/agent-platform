import {
  Bot,
  CalendarClock,
  CircleDashed,
  Globe,
  Layers,
  type LucideIcon,
  MessageCircle,
  Slack,
  Terminal,
  Users,
  Webhook,
} from 'lucide-react'

/**
 * Per-source leading icon and label key, shared by the session rows and the
 * filter menu so a source looks the same wherever it is named.
 *
 * Literal switch (not `icons[source]`) keeps each source greppable. A source
 * this build doesn't know gets `labelKey: null` and is rendered under its raw
 * value — folding it into 'web' would print two identically-labelled entries
 * in the filter menu with no way to tell them apart.
 */
export function sourceVisual(source: string): { Icon: LucideIcon; labelKey: string | null } {
  switch (source) {
    case 'web':
      return { Icon: Globe, labelKey: 'web' }
    case 'schedule':
      return { Icon: CalendarClock, labelKey: 'schedule' }
    case 'slack':
      return { Icon: Slack, labelKey: 'slack' }
    case 'wecom':
      return { Icon: MessageCircle, labelKey: 'wecom' }
    case 'webhook':
      return { Icon: Webhook, labelKey: 'webhook' }
    case 'agent':
      return { Icon: Bot, labelKey: 'agent' }
    case 'api':
      return { Icon: Terminal, labelKey: 'api' }
    case 'batch':
      return { Icon: Layers, labelKey: 'batch' }
    case 'teamwork':
      return { Icon: Users, labelKey: 'teamwork' }
    default:
      return { Icon: CircleDashed, labelKey: null }
  }
}

/** Display name for a source: the translated label, or the raw value if unknown. */
export function sourceLabel(source: string, t: (key: string) => string): string {
  const { labelKey } = sourceVisual(source)
  return labelKey ? t(`components.sessions.source.${labelKey}`) : source
}

/**
 * Source order in the filter menu. Anything the workspace has seen but that
 * isn't listed here (a connector type newer than this build) sorts last rather
 * than disappearing.
 */
const SOURCE_ORDER = [
  'web',
  'schedule',
  'slack',
  'wecom',
  'webhook',
  'agent',
  'api',
  'batch',
  'teamwork',
]

export function sortSources(sources: string[]): string[] {
  return [...sources].sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a)
    const bi = SOURCE_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}
