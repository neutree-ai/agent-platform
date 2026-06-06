import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyHero } from '@/components/ui/empty-hero'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type AfsShareSummary,
  createAfsShare,
  deleteAfsShare,
  listAfsShares,
  removeAfsShareMember,
} from '@/lib/api/agent-files'
import { formatFullTime, formatRelativeTime } from '@/lib/relative-time'
import { filesRefresh } from '@/plugins/files'
import { Folder, FolderPlus, MoreVertical } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from './ConfirmDialog'
import { ManageMembersDialog } from './ManageMembersDialog'
import { NewShareDialog } from './NewShareDialog'

interface AfsSharesPanelProps {
  workspaceId: string
  onOpenShare: (name: string) => void
  searchQuery: string
  /** Bumped by the parent when the header refresh button is clicked. */
  refreshToken?: number
}

export function AfsSharesPanel({
  workspaceId,
  onOpenShare,
  searchQuery,
  refreshToken,
}: AfsSharesPanelProps) {
  const { t, i18n } = useTranslation()
  const [shares, setShares] = useState<AfsShareSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [manageTarget, setManageTarget] = useState<AfsShareSummary | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    type: 'delete' | 'leave'
    share: AfsShareSummary
  } | null>(null)
  const agentFilesToken = filesRefresh.useToken()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listAfsShares(workspaceId)
      setShares(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    // refreshToken: bumped by the parent (manual refresh button).
    // agentFilesToken: bumped by the agent-session store when a file- or
    // share-mutating tool completes (share_folder / grant_access /
    // unshare_from_all / Write / Edit / Bash / …).
  }, [refresh, refreshToken, agentFilesToken])

  async function handleCreate(name: string) {
    await createAfsShare(workspaceId, name)
    await refresh()
  }

  async function confirmPending() {
    if (!pendingAction) return
    const { type, share } = pendingAction
    try {
      if (type === 'delete') {
        await deleteAfsShare(workspaceId, share.id)
      } else {
        await removeAfsShareMember(workspaceId, share.id, workspaceId)
      }
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const q = searchQuery.trim().toLowerCase()
  const filtered = q ? shares.filter((s) => s.name.toLowerCase().includes(q)) : shares

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* New-share action strip — same h-8 / hairline rhythm as the file
          listing column header, so afs-root and folder views feel cohesive. */}
      <div className="sticky top-0 z-[1] flex h-8 shrink-0 items-center justify-end border-b border-foreground/[0.08] bg-card px-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs hover:bg-foreground/[0.06]"
          onClick={() => setNewOpen(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {t('components.afsShares.newShare')}
        </Button>
      </div>

      {error && (
        <div className="shrink-0 p-3">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyHero
            illustration={
              <img
                src={shares.length === 0 ? '/empty/files.webp' : '/empty/search.webp'}
                alt=""
                className="h-32 w-auto"
              />
            }
            title={t(
              shares.length === 0
                ? 'components.afsShares.empty.noShares.title'
                : 'components.afsShares.empty.noMatch.title',
            )}
            description={t(
              shares.length === 0
                ? 'components.afsShares.empty.noShares.description'
                : 'components.afsShares.empty.noMatch.description',
            )}
            action={
              shares.length === 0 ? (
                <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>
                  <FolderPlus className="mr-1 h-3.5 w-3.5" />
                  {t('components.afsShares.newShare')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-foreground/[0.05]">
            {filtered.map((s) => {
              const roleLabel =
                s.role === 'owner'
                  ? t('components.afsShares.role.owner')
                  : s.my_permission === 'read_only'
                    ? t('components.afsShares.perm.ro')
                    : t('components.afsShares.perm.rw')
              // owner = primary tint; rw member = info tint; ro member = muted.
              const badgeTone =
                s.role === 'owner'
                  ? 'border-primary/30 bg-primary/[0.08] text-primary/90'
                  : s.my_permission === 'read_write'
                    ? 'border-info/30 bg-info/[0.08] text-info'
                    : 'border-foreground/[0.10] bg-foreground/[0.04] text-muted-foreground'
              return (
                <div
                  key={s.id}
                  className="group flex select-none items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-foreground/[0.04]"
                  onDoubleClick={() => onOpenShare(s.name)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Folder className="h-4 w-4 shrink-0 text-chart-1" />
                    <span className="truncate font-medium">{s.name}</span>
                    <Badge
                      variant="outline"
                      className={`h-4 px-1.5 text-[10px] font-normal ${badgeTone}`}
                    >
                      {roleLabel}
                    </Badge>
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 cursor-default text-xs text-muted-foreground tabular-nums">
                        {formatRelativeTime(s.created_at, i18n.language)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs tabular-nums">
                      {formatFullTime(s.created_at, i18n.language)}
                    </TooltipContent>
                  </Tooltip>

                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground data-[state=open]:opacity-100"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {s.role === 'owner' && (
                          <>
                            <DropdownMenuItem onSelect={() => setManageTarget(s)}>
                              {t('components.afsShares.action.manageMembers')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onSelect={() => setPendingAction({ type: 'delete', share: s })}
                            >
                              {t('components.afsShares.action.delete')}
                            </DropdownMenuItem>
                          </>
                        )}
                        {s.role === 'member' && (
                          <DropdownMenuItem
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onSelect={() => setPendingAction({ type: 'leave', share: s })}
                          >
                            {t('components.afsShares.action.leave')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}

      <NewShareDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={handleCreate} />

      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={
          pendingAction?.type === 'delete'
            ? t('components.afsShares.action.delete')
            : t('components.afsShares.action.leave')
        }
        description={
          pendingAction
            ? t(
                pendingAction.type === 'delete'
                  ? 'components.afsShares.confirmDelete'
                  : 'components.afsShares.confirmLeave',
                { name: pendingAction.share.name },
              )
            : undefined
        }
        destructive
        onConfirm={confirmPending}
      />

      {manageTarget && (
        <ManageMembersDialog
          open={!!manageTarget}
          onOpenChange={(o) => !o && setManageTarget(null)}
          workspaceId={workspaceId}
          share={manageTarget}
          onChanged={refresh}
        />
      )}
    </div>
  )
}
