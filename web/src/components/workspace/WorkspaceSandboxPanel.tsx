import { ResourceCard } from '@/components/resource/ResourceCard'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Spinner } from '@/components/ui/spinner'
import { SandboxDialog } from '@/components/workspace/SandboxDialog'
import { useDeleteSandbox, useSandboxes } from '@/hooks/useSandboxes'
import type { SandboxInfo } from '@/lib/api/types'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface Props {
  workspaceId: string
  // Currently no per-instance state to persist; kept on the prop signature
  // so the slot wiring stays consistent with other apps.
  instanceId: string
}

// Forces a re-render every 30s so countdown labels stay live without
// waiting for the 30s react-query refetch to land.
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])
}

function formatRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`
}

function formatExpires(expiresAt: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(expiresAt))
}

export function WorkspaceSandboxPanel({ workspaceId }: Props) {
  const { t, i18n } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const { data, isLoading } = useSandboxes(workspaceId)
  const [createOpen, setCreateOpen] = useState(false)
  useMinuteTick()

  const sandboxes = data?.items ?? []

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" /> {t('components.workspaceSandbox.states.loading')}
      </div>
    )
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            {sandboxes.length > 0 && (
              <Badge
                variant="secondary"
                className="h-4 shrink-0 px-1 text-mini font-medium tabular-nums"
              >
                {sandboxes.length}
              </Badge>
            )}
            <AppHeaderButton
              icon={Plus}
              label={t('components.workspaceSandbox.actions.create')}
              onClick={() => setCreateOpen(true)}
            />
          </>,
          headerSlot,
        )}

      <SandboxDialog workspaceId={workspaceId} open={createOpen} onOpenChange={setCreateOpen} />

      {sandboxes.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyHero
            illustration={<EmptyIllustration src="sandboxes" size="h-32" />}
            title={t('components.workspaceSandbox.empty.title')}
            description={t('components.workspaceSandbox.empty.description')}
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3 w-3" />
                {t('components.workspaceSandbox.actions.create')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
            {sandboxes.map((sbx) => (
              <SandboxCard
                key={sbx.id}
                workspaceId={workspaceId}
                sandbox={sbx}
                language={i18n.language}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function SandboxCard({
  workspaceId,
  sandbox,
  language,
}: {
  workspaceId: string
  sandbox: SandboxInfo
  language: string
}) {
  const { t } = useTranslation()
  const deleteMutation = useDeleteSandbox(workspaceId)
  const state = sandbox.status.state
  const isRunning = state === 'Running'
  const remaining = sandbox.expiresAt ? formatRemaining(sandbox.expiresAt) : null
  const expires = sandbox.expiresAt ? formatExpires(sandbox.expiresAt, language) : null

  return (
    <ResourceCard
      name={<code className="font-mono text-sm">{sandbox.id.slice(0, 12)}</code>}
      description={sandbox.image?.uri || t('components.workspaceSandbox.unknownImage')}
      type={
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              isRunning ? 'bg-success' : 'bg-muted-foreground/40'
            }`}
          />
          {state}
        </span>
      }
      meta={
        expires
          ? t('components.workspaceSandbox.expiresMeta', {
              when: expires,
              remaining: remaining ?? '',
            })
          : undefined
      }
      actions={
        <ConfirmButton
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(sandbox.id)}
          icon={<Trash2 className="h-3 w-3" />}
          tooltip={t('components.workspaceSandbox.actions.delete')}
        />
      }
    />
  )
}
