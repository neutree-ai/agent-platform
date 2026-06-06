import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  type AfsShareMember,
  type AfsShareSummary,
  addAfsShareMember,
  listAfsShareMembers,
  removeAfsShareMember,
} from '@/lib/api/agent-files'
import { api } from '@/lib/api/client'
import type { Workspace } from '@/lib/api/types'
import { Trash2, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ManageMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  share: AfsShareSummary
  onChanged?: () => void
}

export function ManageMembersDialog({
  open,
  onOpenChange,
  workspaceId,
  share,
  onChanged,
}: ManageMembersDialogProps) {
  const { t } = useTranslation()
  const [members, setMembers] = useState<AfsShareMember[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<string>('')
  const [addReadonly, setAddReadonly] = useState<'read_only' | 'read_write'>('read_only')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, ws] = await Promise.all([
        listAfsShareMembers(workspaceId, share.id),
        api.getWorkspaces(),
      ])
      setMembers(m)
      setWorkspaces(ws)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, share.id])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const memberIds = new Set(members.map((m) => m.workspace_id))
  const candidates = workspaces.filter(
    (w) => w.id !== share.owner_workspace_id && !memberIds.has(w.id),
  )

  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id

  async function handleAdd() {
    if (!addTarget) return
    setBusy(true)
    setError(null)
    try {
      await addAfsShareMember(workspaceId, share.id, addTarget, addReadonly === 'read_only')
      setAddTarget('')
      await refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(memberId: string) {
    setBusy(true)
    setError(null)
    try {
      await removeAfsShareMember(workspaceId, share.id, memberId)
      await refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleChangePermission(memberId: string, next: 'read_only' | 'read_write') {
    setBusy(true)
    setError(null)
    try {
      // Backend upserts: same endpoint re-mounts with new permission.
      await addAfsShareMember(workspaceId, share.id, memberId, next === 'read_only')
      await refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.afsShares.members.title', { name: share.name })}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Owner row */}
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                {wsName(share.owner_workspace_id)}
                {share.owner_workspace_id === workspaceId && (
                  <span className="text-muted-foreground">
                    {' '}
                    {t('components.afsShares.members.you')}
                  </span>
                )}
              </span>
              <Badge variant="secondary">{t('components.afsShares.members.owner')}</Badge>
            </div>

            {/* Members */}
            {members
              .filter((m) => m.workspace_id !== share.owner_workspace_id)
              .map((m) => (
                <div key={m.workspace_id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{wsName(m.workspace_id)}</span>
                  {share.role === 'owner' ? (
                    <Select
                      value={m.permission}
                      onValueChange={(v) =>
                        handleChangePermission(m.workspace_id, v as 'read_only' | 'read_write')
                      }
                      disabled={busy}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_only">
                          {t('components.afsShares.perm.ro')}
                        </SelectItem>
                        <SelectItem value="read_write">
                          {t('components.afsShares.perm.rw')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      {m.permission === 'read_only'
                        ? t('components.afsShares.perm.ro')
                        : t('components.afsShares.perm.rw')}
                    </Badge>
                  )}
                  {share.role === 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => handleRemove(m.workspace_id)}
                      title={t('components.afsShares.members.remove')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}

            {/* Add member (owner only) */}
            {share.role === 'owner' && (
              <div className="flex items-center gap-2 border-t border-border pt-3">
                <Select value={addTarget} onValueChange={setAddTarget}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('components.afsShares.members.selectWs')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.length === 0 && (
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        {t('components.afsShares.members.noCandidates')}
                      </div>
                    )}
                    {candidates.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={addReadonly}
                  onValueChange={(v) => setAddReadonly(v as 'read_only' | 'read_write')}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read_only">{t('components.afsShares.perm.ro')}</SelectItem>
                    <SelectItem value="read_write">{t('components.afsShares.perm.rw')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleAdd}
                  disabled={busy || !addTarget}
                  title={t('components.afsShares.members.add')}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
