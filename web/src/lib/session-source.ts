import {
  Bot,
  CalendarClock,
  Globe,
  type LucideIcon,
  MessageCircle,
  Slack,
  Webhook,
} from 'lucide-react'

/**
 * Per-source leading icon and label key, shared by the session rows and the
 * filter menu so a source looks the same wherever it is named.
 *
 * Literal switch (not `icons[source]`) keeps each source greppable and lets
 * new connector types fail loudly into the muted fallback.
 */
export function sourceVisual(source: string): { Icon: LucideIcon; labelKey: string } {
  switch (source) {
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
    default:
      // 'web' (manual) and any unknown source.
      return { Icon: Globe, labelKey: 'web' }
  }
}

/**
 * Source order in the filter menu. Anything the workspace has seen but that
 * isn't listed here (a connector type newer than this build) sorts last rather
 * than disappearing.
 */
const SOURCE_ORDER = ['web', 'schedule', 'slack', 'wecom', 'webhook', 'agent']

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
