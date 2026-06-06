import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api/client'
import type { Workspace } from '@/lib/api/types'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// --- Event type registry ---

type ScopeType = 'workspace' | 'none'

interface EventTypeConfig {
  key: string
  labelKey: string
  scopeType: ScopeType
}

const EVENT_TYPES: EventTypeConfig[] = [
  {
    key: 'agent.task_done',
    labelKey: 'components.preferences.notifications.events.agentTaskDone',
    scopeType: 'workspace',
  },
  {
    key: 'forum.thread_updated',
    labelKey: 'components.preferences.notifications.events.forumThreadUpdated',
    scopeType: 'none',
  },
]

// --- Channel registry ---

const CHANNELS = [
  { id: 'wecom', labelKey: 'components.preferences.notifications.channels.wecom' },
] as const

// --- Types ---

/** Key format: `${eventType}:${scope}:${channel}` */
type PrefKey = string
function prefKey(eventType: string, scope: string, channel: string): PrefKey {
  return `${eventType}:${scope}:${channel}`
}

interface PrefState {
  /** Explicit preferences from backend. Key → enabled. Missing = inherited. */
  explicit: Map<PrefKey, boolean>
  /** Loading state for individual toggles */
  loading: Set<PrefKey>
}

export function NotificationConfig() {
  const [prefs, setPrefs] = useState<PrefState>({ explicit: new Map(), loading: new Set() })
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    Promise.all([api.getNotificationPreferences(), api.getWorkspaces()])
      .then(([prefRows, wsList]) => {
        const explicit = new Map<PrefKey, boolean>()
        for (const p of prefRows) {
          explicit.set(prefKey(p.event_type, p.scope, p.channel), p.enabled)
        }
        setPrefs({ explicit, loading: new Set() })
        setWorkspaces(wsList.filter((ws) => !ws.is_system))
        setLoaded(true)
      })
      .catch(() => {})
  }, [loaded])

  /** Resolve effective value for a preference (with fallback chain) */
  const resolve = useCallback(
    (eventType: string, scope: string, channel: string): boolean => {
      const m = prefs.explicit
      // 1. exact event + exact scope
      const v1 = m.get(prefKey(eventType, scope, channel))
      if (v1 !== undefined) return v1
      return resolveInherited(eventType, scope, channel)
    },
    [prefs.explicit],
  )

  /** Resolve the inherited value (skipping the most specific match) */
  const resolveInherited = useCallback(
    (eventType: string, scope: string, channel: string): boolean => {
      const m = prefs.explicit
      // 2. exact event + global scope
      if (scope !== '*') {
        const v2 = m.get(prefKey(eventType, '*', channel))
        if (v2 !== undefined) return v2
      }
      // 3. wildcard event + exact scope
      if (eventType !== '*') {
        const v3 = m.get(prefKey('*', scope, channel))
        if (v3 !== undefined) return v3
      }
      // 4. wildcard event + global scope
      if (eventType !== '*' && scope !== '*') {
        const v4 = m.get(prefKey('*', '*', channel))
        if (v4 !== undefined) return v4
      }
      return false
    },
    [prefs.explicit],
  )

  const isLoading = useCallback(
    (eventType: string, scope: string, channel: string): boolean => {
      return prefs.loading.has(prefKey(eventType, scope, channel))
    },
    [prefs.loading],
  )

  async function togglePref(eventType: string, scope: string, channel: string) {
    const key = prefKey(eventType, scope, channel)
    const current = resolve(eventType, scope, channel)
    const next = !current
    const inherited = resolveInherited(eventType, scope, channel)
    // If toggling to the same value as inherited, delete the override instead
    const shouldDelete = next === inherited

    setPrefs((prev) => {
      const explicit = new Map(prev.explicit)
      if (shouldDelete) explicit.delete(key)
      else explicit.set(key, next)
      return { explicit, loading: new Set(prev.loading).add(key) }
    })

    try {
      if (shouldDelete) {
        await api.deleteNotificationPreference(eventType, channel, scope)
      } else {
        await api.setNotificationPreference(eventType, channel, next, scope)
      }
    } catch {
      // Revert on error
      setPrefs((prev) => {
        const explicit = new Map(prev.explicit)
        if (shouldDelete) explicit.set(key, current)
        else explicit.delete(key)
        return { ...prev, explicit }
      })
    } finally {
      setPrefs((prev) => {
        const loading = new Set(prev.loading)
        loading.delete(key)
        return { ...prev, loading }
      })
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {EVENT_TYPES.map((evt) => (
        <EventSection
          key={evt.key}
          config={evt}
          workspaces={workspaces}
          prefs={prefs}
          resolve={resolve}
          isLoading={isLoading}
          onToggle={togglePref}
        />
      ))}
    </div>
  )
}

// --- Event section (collapsible) ---

interface EventSectionProps {
  config: EventTypeConfig
  workspaces: Workspace[]
  prefs: PrefState
  resolve: (eventType: string, scope: string, channel: string) => boolean
  isLoading: (eventType: string, scope: string, channel: string) => boolean
  onToggle: (eventType: string, scope: string, channel: string) => void
}

function EventSection({
  config,
  workspaces,
  prefs,
  resolve,
  isLoading,
  onToggle,
}: EventSectionProps) {
  const { t } = useTranslation()
  const [scopeOpen, setScopeOpen] = useState(false)

  // Count workspace-level overrides for this event
  const overrideCount =
    config.scopeType === 'workspace'
      ? workspaces.filter((ws) =>
          CHANNELS.some((ch) => prefs.explicit.has(prefKey(config.key, `ws:${ws.id}`, ch.id))),
        ).length
      : 0

  return (
    <div className="rounded-lg border border-border">
      {/* Event type header */}
      <div className="px-3 py-2 text-xs font-medium text-foreground">{t(config.labelKey)}</div>

      <div className="border-t border-border">
        {/* Channel header + global default row */}
        <div className="flex items-center px-3 py-1.5 bg-muted/30">
          <span className="flex-1 text-mini text-muted-foreground">
            {t('components.preferences.notifications.globalDefault')}
          </span>
          {CHANNELS.map((ch) => (
            <span key={ch.id} className="w-16 text-center text-mini text-muted-foreground">
              {t(ch.labelKey)}
            </span>
          ))}
        </div>

        <ChannelRow
          eventType={config.key}
          scope="*"
          resolve={resolve}
          isLoading={isLoading}
          onToggle={onToggle}
        />

        {/* Workspace scope list (collapsible) */}
        {config.scopeType === 'workspace' && workspaces.length > 0 && (
          <Collapsible open={scopeOpen} onOpenChange={setScopeOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <ChevronRight
                  className={`h-2.5 w-2.5 text-muted-foreground transition-transform ${scopeOpen ? 'rotate-90' : ''}`}
                />
                <span className="flex-1 text-left text-mini text-muted-foreground">
                  {t('components.preferences.notifications.workspaces')}
                  {overrideCount > 0 && (
                    <span className="ml-1 text-micro text-primary">
                      ({overrideCount} {overrideCount === 1 ? 'override' : 'overrides'})
                    </span>
                  )}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {workspaces.map((ws) => (
                <ChannelRow
                  key={ws.id}
                  label={ws.name}
                  status={ws.status}
                  eventType={config.key}
                  scope={`ws:${ws.id}`}
                  resolve={resolve}
                  isLoading={isLoading}
                  onToggle={onToggle}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}

// --- Channel row (one scope entry with toggle per channel) ---

interface ChannelRowProps {
  label?: string
  status?: string
  eventType: string
  scope: string
  resolve: (eventType: string, scope: string, channel: string) => boolean
  isLoading: (eventType: string, scope: string, channel: string) => boolean
  onToggle: (eventType: string, scope: string, channel: string) => void
}

function ChannelRow({
  label,
  status,
  eventType,
  scope,
  resolve,
  isLoading,
  onToggle,
}: ChannelRowProps) {
  const statusColor = status === 'running' ? 'bg-success' : 'bg-muted-foreground/40'

  return (
    <div className="flex items-center px-3 py-1.5 hover:bg-muted/20 transition-colors">
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {status && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />}
        {label && <span className="text-xs text-foreground truncate">{label}</span>}
      </div>
      {CHANNELS.map((ch) => {
        const loading = isLoading(eventType, scope, ch.id)
        const value = resolve(eventType, scope, ch.id)

        return (
          <div key={ch.id} className="w-16 h-6 flex items-center justify-center">
            {loading ? (
              <Spinner size="sm" className="h-3.5 w-3.5" />
            ) : (
              <Switch checked={value} onCheckedChange={() => onToggle(eventType, scope, ch.id)} />
            )}
          </div>
        )
      })}
    </div>
  )
}
