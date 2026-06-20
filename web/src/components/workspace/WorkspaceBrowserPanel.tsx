import { LaunchBrowserDialog } from '@/components/dialogs/LaunchBrowserDialog'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useBrowsers, useDeleteBrowser, useRenewBrowser } from '@/hooks/useBrowsers'
import type { BrowserSession } from '@/lib/api/types'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { Check, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface Props {
  workspaceId: string
  instanceId: string
}

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`
}

// Forces a re-render every 30s so countdown labels stay live without
// waiting for react-query to refetch the session list.
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])
}

function LiveViewEmbed({ url }: { url: string }) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    let cancelled = false

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(url)
          // 502 = proxy can't reach sandbox yet; anything else means the service is up
          if (res.status !== 502 && !cancelled) {
            setReady(true)
            return
          }
        } catch {
          // network error, retry
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [url])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" /> {t('components.workspaceBrowser.states.waiting')}
      </div>
    )
  }

  return (
    <iframe
      title={t('components.workspaceBrowser.sessionTitle')}
      src={url}
      className="w-full h-full border-0"
      allow="clipboard-read; clipboard-write"
    />
  )
}

// Portals all browser-app actions into the AppWindow header. Renders the
// "new browser" trigger unconditionally; when a session is selected, also
// surfaces its globe/status/remaining + extend/delete controls. With
// multiple sessions, swaps the static globe icon for a Select picker so
// switching is one click and the live view fills the panel uncontested.
function BrowserAppHeader({
  browsers,
  selected,
  onSelect,
  workspaceId,
  onLaunch,
}: {
  browsers: BrowserSession[]
  selected: BrowserSession | null
  onSelect: (id: string) => void
  workspaceId: string
  onLaunch: () => void
}) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const renewMutation = useRenewBrowser(workspaceId)
  const deleteMutation = useDeleteBrowser(workspaceId)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>()
  useMinuteTick()

  useEffect(() => {
    return () => clearTimeout(deleteTimerRef.current)
  }, [])

  // Disarm delete confirmation whenever the selected session changes —
  // arming is a per-session intent, it shouldn't carry across.
  useEffect(() => {
    setDeleteArmed(false)
    clearTimeout(deleteTimerRef.current)
  }, [selected?.id])

  function handleDeleteClick() {
    if (!selected) return
    if (deleteArmed) {
      deleteMutation.mutate(selected.id)
      setDeleteArmed(false)
      clearTimeout(deleteTimerRef.current)
    } else {
      setDeleteArmed(true)
      deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), 3000)
    }
  }

  if (!headerSlot) return null

  const multi = browsers.length > 1

  return createPortal(
    <>
      {selected && (
        <>
          {multi && (
            <Select value={selected.id} onValueChange={onSelect}>
              <SelectTrigger
                aria-label={t('components.workspaceBrowser.selectSession')}
                className="h-7 min-w-[140px] max-w-[220px] border-transparent bg-foreground/[0.04] px-2 text-xs shadow-none hover:bg-foreground/[0.07] focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-foreground/[0.09] [&>span]:truncate"
              >
                <SelectValue>
                  <span className="font-mono">{selected.id.slice(0, 8)}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {browsers.map((b) => (
                  <SelectItem
                    key={b.id}
                    value={b.id}
                    className="py-1.5"
                    description={t('components.workspaceBrowser.remaining', {
                      value: formatTimeRemaining(b.expires_at),
                    })}
                  >
                    <span className="font-mono text-xs">{b.id.slice(0, 12)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge
            variant={selected.status === 'Running' ? 'success' : 'secondary'}
            className="h-4 shrink-0 px-1 text-mini font-medium"
          >
            {selected.status}
          </Badge>
          {!multi && (
            <span className="shrink-0 text-mini text-muted-foreground">
              {t('components.workspaceBrowser.remaining', {
                value: formatTimeRemaining(selected.expires_at),
              })}
            </span>
          )}
          <AppHeaderButton
            icon={RefreshCw}
            label={t('components.workspaceBrowser.actions.extendOneHour')}
            disabled={renewMutation.isPending}
            onClick={() => renewMutation.mutate({ browserId: selected.id, timeoutSeconds: 3600 })}
          />
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
        </>
      )}
      <AppHeaderButton
        icon={Plus}
        label={t('components.workspaceBrowser.actions.newBrowser')}
        onClick={onLaunch}
      />
      {selected && (
        <AppHeaderButton
          icon={deleteArmed ? Check : Trash2}
          tone="destructive"
          label={
            deleteArmed
              ? t('components.workspaceBrowser.actions.deleteConfirm')
              : t('components.workspaceBrowser.actions.delete')
          }
          disabled={deleteMutation.isPending}
          onClick={handleDeleteClick}
        />
      )}
    </>,
    headerSlot,
  )
}

export function WorkspaceBrowserPanel({ workspaceId, instanceId }: Props) {
  const { t } = useTranslation()
  const { data, isLoading } = useBrowsers(workspaceId)
  // Persisted: which browser session the user is viewing.
  const [selectedId, setSelectedId] = useInstancePersistentState<string | null>(
    instanceId,
    'selectedId',
    () => null,
  )
  const [launchOpen, setLaunchOpen] = useState(false)

  const browsers = data?.items ?? []
  const activeBrowsers = useMemo(
    () =>
      browsers.filter(
        (b) => b.status === 'Running' || b.status === 'Pending' || b.status === 'Allocated',
      ),
    [browsers],
  )

  // Auto-select first browser if none selected or selected was removed
  useEffect(() => {
    if (!selectedId && activeBrowsers.length > 0) {
      setSelectedId(activeBrowsers[0].id)
    } else if (selectedId && !activeBrowsers.find((b) => b.id === selectedId)) {
      setSelectedId(activeBrowsers[0]?.id ?? null)
    }
  }, [activeBrowsers, selectedId])

  const selected = activeBrowsers.find((b) => b.id === selectedId) ?? activeBrowsers[0] ?? null

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" /> {t('components.workspaceBrowser.states.loading')}
      </div>
    )
  }

  const launch = () => setLaunchOpen(true)

  return (
    <>
      <BrowserAppHeader
        browsers={activeBrowsers}
        selected={selected}
        onSelect={setSelectedId}
        workspaceId={workspaceId}
        onLaunch={launch}
      />
      <LaunchBrowserDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        workspaceId={workspaceId}
      />
      {activeBrowsers.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyHero
            illustration={<EmptyIllustration src="browser" size="h-40" />}
            title={t('components.workspaceBrowser.empty.title')}
            description={t('components.workspaceBrowser.empty.description')}
            action={
              <Button type="button" size="sm" variant="outline" onClick={launch}>
                <Plus className="mr-1 h-3 w-3" />
                {t('components.workspaceBrowser.actions.launch')}
              </Button>
            }
          />
        </div>
      ) : (
        <SelectedView selected={selected} />
      )}
    </>
  )
}

function SelectedView({ selected }: { selected: BrowserSession | null }) {
  const { t } = useTranslation()
  if (!selected) return null
  if (!selected.live_view_url) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" /> {t('components.workspaceBrowser.states.starting')}
      </div>
    )
  }
  return <LiveViewEmbed url={selected.live_view_url} />
}
