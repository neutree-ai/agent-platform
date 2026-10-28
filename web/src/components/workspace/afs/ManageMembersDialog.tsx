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
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import {
  type AfsPermission,
  type AfsShareGrant,
  type AfsShareMember,
  type AfsShareSummary,
  addAfsShareMember,
  deleteAfsShareGrant,
  listAfsShareGrants,
  listAfsShareMembers,
  putAfsShareGrant,
  removeAfsShareMember,
} from '@/lib/api/agent-files'
import { api } from '@/lib/api/client'
import { useQuery } from '@tanstack/react-query'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AfsPermissionSelect, afsPermissionKey } from './AfsPermissionSelect'

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
  const { user } = useAuth()
  const callerIsOwner = user?.id === share.owner_user_id
  // Sharing beyond the owner's own workspaces is the owner's to do.
  const canShareWithTeams = share.role === 'owner' && callerIsOwner
  const { data: workspaces = [] } = useWorkspaces()
  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
    enabled: open && canShareWithTeams,
  })
  const [members, setMembers] = useState<AfsShareMember[]>([])
  const [grants, setGrants] = useState<AfsShareGrant[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<string>('')
  const [addPermission, setAddPermission] = useState<AfsPermission>('read_only')
  const [addTeam, setAddTeam] = useState<string>('')
  const [addTeamPermission, setAddTeamPermission] = useState<AfsPermission>('read_only')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [m, g] = await Promise.all([
      listAfsShareMembers(workspaceId, share.id),
      canShareWithTeams ? listAfsShareGrants(workspaceId, share.id) : Promise.resolve([]),
    ])
    setMembers(m)
    setGrants(g)
  }, [workspaceId, share.id, canShareWithTeams])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    refresh()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open, refresh])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const memberIds = new Set(members.map((m) => m.workspace_id))
  // Direct members are the owner's own workspaces; others get it through teams.
  const candidates = workspaces.filter(
    (w) =>
      w.id !== share.owner_workspace_id &&
      !memberIds.has(w.id) &&
      (!callerIsOwner || w.access === 'owner'),
  )

  const grantedTeams = new Set(grants.map((g) => g.team_id))
  const teamCandidates = teams.filter((tm) => !grantedTeams.has(tm.id))

  const ownerName =
    members.find((m) => m.workspace_id === share.owner_workspace_id)?.workspace_name ??
    workspaces.find((w) => w.id === share.owner_workspace_id)?.name ??
    share.owner_workspace_id

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
                {ownerName}
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
                  <span className="flex-1 truncate">
                    {m.workspace_name}
                    {m.source === 'team' && (
                      <span className="text-muted-foreground"> · {m.user_display_name}</span>
                    )}
                  </span>
                  {/* A team member's permission follows the team grants. */}
                  {share.role === 'owner' && m.source === 'direct' ? (
                    <AfsPermissionSelect
                      value={m.permission}
                      // Backend upserts: same endpoint re-mounts with new permission.
                      onChange={(p) =>
                        run(() =>
                          addAfsShareMember(
                            workspaceId,
                            share.id,
                            m.workspace_id,
                            p === 'read_only',
                          ),
                        )
                      }
                      disabled={busy}
                      className="h-7 w-24 text-xs"
                    />
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      {t(afsPermissionKey(m.permission))}
                    </Badge>
                  )}
                  {share.role === 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() =>
                        run(() => removeAfsShareMember(workspaceId, share.id, m.workspace_id))
                      }
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
                <AfsPermissionSelect value={addPermission} onChange={setAddPermission} />
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    run(async () => {
                      await addAfsShareMember(
                        workspaceId,
                        share.id,
                        addTarget,
                        addPermission === 'read_only',
                      )
                      setAddTarget('')
                    })
                  }
                  disabled={busy || !addTarget}
                  title={t('components.afsShares.members.add')}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Team grants (the workspace's owner only) */}
            {canShareWithTeams && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {t('components.afsShares.teams.title')}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('components.afsShares.teams.hint')}
                </p>
                {grants.map((g) => (
                  <div key={g.team_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{g.team_name}</span>
                    <AfsPermissionSelect
                      value={g.permission}
                      onChange={(p) =>
                        run(() => putAfsShareGrant(workspaceId, share.id, g.team_id, p))
                      }
                      disabled={busy}
                      className="h-7 w-24 text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() =>
                        run(() => deleteAfsShareGrant(workspaceId, share.id, g.team_id))
                      }
                      title={t('components.afsShares.teams.remove')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Select value={addTeam} onValueChange={setAddTeam}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t('components.afsShares.teams.selectTeam')} />
                    </SelectTrigger>
                    <SelectContent>
                      {teamCandidates.length === 0 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                          {t('components.afsShares.teams.noCandidates')}
                        </div>
                      )}
                      {teamCandidates.map((tm) => (
                        <SelectItem key={tm.id} value={tm.id}>
                          {tm.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AfsPermissionSelect value={addTeamPermission} onChange={setAddTeamPermission} />
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    disabled={busy || !addTeam}
                    onClick={() =>
                      run(async () => {
                        await putAfsShareGrant(workspaceId, share.id, addTeam, addTeamPermission)
                        setAddTeam('')
                      })
                    }
                    title={t('components.afsShares.teams.add')}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
