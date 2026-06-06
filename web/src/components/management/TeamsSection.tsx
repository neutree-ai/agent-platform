import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import type { ApiTeam, ApiTeamInvite, ApiTeamMember, TeamRole } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, LogOut, Plus, Trash2, UserMinus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const teamsKey = ['teams'] as const
const teamMembersKey = (id: string) => ['teams', id, 'members'] as const
const teamInvitesKey = (id: string) => ['teams', id, 'invites'] as const

export function TeamsSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)

  const { data: teams = [], isLoading } = useQuery<ApiTeam[]>({
    queryKey: teamsKey,
    queryFn: () => api.listTeams(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTeam(id),
    onSuccess: () => {
      toast.success(t('components.teamsSection.toasts.deleted'))
      queryClient.invalidateQueries({ queryKey: teamsKey })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.deleteFailed'),
      ),
  })
  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  return (
    <>
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.teamsSection.actions.new')}
            onClick={() => setCreateOpen(true)}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : teams.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <ResourceGrid>
            {teams.map((team) => {
              const isAdmin = team.my_role === 'admin'
              const deleting = deletingId === team.id
              return (
                <ResourceCard
                  key={team.id}
                  name={team.name}
                  description={team.description || undefined}
                  meta={t('components.teamsSection.labels.memberCount', {
                    count: team.member_count,
                  })}
                  type={<RoleBadge role={team.my_role} />}
                  onClick={() => setActiveTeamId(team.id)}
                  actions={
                    isAdmin &&
                    (deleting ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled
                      >
                        <Spinner size="sm" className="h-3 w-3" />
                      </Button>
                    ) : (
                      <ConfirmButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        disabled={deleteMutation.isPending}
                        onConfirm={() => deleteMutation.mutate(team.id)}
                        icon={<Trash2 className="h-3 w-3" />}
                        tooltip={t('components.teamsSection.actions.delete')}
                      />
                    ))
                  }
                />
              )
            })}
          </ResourceGrid>
        )}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setActiveTeamId(id)}
      />
      <TeamDialog teamId={activeTeamId} onClose={() => setActiveTeamId(null)} />
    </>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={
        <div className="relative inline-flex items-center justify-center">
          <div aria-hidden className="absolute h-32 w-32 rounded-full bg-primary/20 blur-3xl" />
          <Users className="relative h-16 w-16 text-primary/70" strokeWidth={1.25} />
        </div>
      }
      title={t('components.teamsSection.empty.title')}
      description={t('components.teamsSection.empty.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.teamsSection.actions.new')}
        </Button>
      }
    />
  )
}

// ── Single dialog covers everything: members, edit, leave/delete ───────────

function TeamDialog({ teamId, onClose }: { teamId: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const open = teamId !== null

  const teamQuery = useQuery<ApiTeam>({
    queryKey: ['teams', teamId],
    queryFn: () => api.getTeam(teamId!),
    enabled: open,
  })
  const membersQuery = useQuery<ApiTeamMember[]>({
    queryKey: teamId ? teamMembersKey(teamId) : ['teams', 'none', 'members'],
    queryFn: () => api.listTeamMembers(teamId!),
    enabled: open,
  })

  const team = teamQuery.data
  const members = membersQuery.data ?? []
  const isAdmin = team?.my_role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin').length
  const myUserId = user?.id

  // Editable header fields. Local-only buffer; commits on blur if changed.
  const [nameDraft, setNameDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const initializedFor = useRef<string | null>(null)
  useEffect(() => {
    if (team && initializedFor.current !== team.id) {
      setNameDraft(team.name)
      setDescDraft(team.description ?? '')
      initializedFor.current = team.id
    }
    if (!open) initializedFor.current = null
  }, [team, open])

  const updateMutation = useMutation({
    mutationFn: (patch: { name?: string; description?: string | null }) =>
      api.updateTeam(teamId!, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamsKey })
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.saveFailed'),
      ),
  })

  function commitName() {
    if (!team) return
    const next = nameDraft.trim()
    if (!next || next === team.name) {
      setNameDraft(team.name)
      return
    }
    updateMutation.mutate({ name: next })
  }
  function commitDesc() {
    if (!team) return
    const next = descDraft.trim()
    if (next === (team.description ?? '')) return
    updateMutation.mutate({ description: next || null })
  }

  const leaveMutation = useMutation({
    mutationFn: () => api.removeTeamMember(teamId!, myUserId!),
    onSuccess: () => {
      toast.success(t('components.teamsSection.toasts.left'))
      queryClient.invalidateQueries({ queryKey: teamsKey })
      onClose()
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.leaveFailed'),
      ),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeTeamMember(teamId!, userId),
    onSuccess: () => {
      toast.success(t('components.teamsSection.toasts.memberRemoved'))
      queryClient.invalidateQueries({ queryKey: teamMembersKey(teamId!) })
      queryClient.invalidateQueries({ queryKey: ['teams', teamId] })
      queryClient.invalidateQueries({ queryKey: teamsKey })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.removeMemberFailed'),
      ),
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamRole }) =>
      api.updateTeamMember(teamId!, userId, role),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.role === 'admin'
          ? t('components.teamsSection.toasts.rolePromoted')
          : t('components.teamsSection.toasts.roleDemoted'),
      )
      queryClient.invalidateQueries({ queryKey: teamMembersKey(teamId!) })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.roleChangeFailed'),
      ),
  })

  const myMembership = members.find((m) => m.user_id === myUserId)
  const canLeave = !!myMembership && (myMembership.role !== 'admin' || adminCount > 1)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {team?.name ?? t('components.teamsSection.dialogs.editTitle')}
          </DialogTitle>
        </DialogHeader>

        {!team ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {isAdmin ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="td-name">{t('components.teamsSection.fields.name')}</Label>
                  <Input
                    id="td-name"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="td-desc">{t('components.teamsSection.fields.description')}</Label>
                  <Textarea
                    id="td-desc"
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={commitDesc}
                    rows={2}
                    placeholder={t('components.teamsSection.fields.descriptionPlaceholder')}
                  />
                </div>
              </div>
            ) : (
              team.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">{team.description}</p>
              )
            )}

            {isAdmin && <InviteLinkSection teamId={team.id} />}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('components.teamsSection.labels.memberCount', { count: members.length })}
                </h3>
              </div>
              <ul className="divide-y divide-foreground/5 rounded-lg bg-foreground/[0.03]">
                {members.map((m) => {
                  const isMe = m.user_id === myUserId
                  const removingThis =
                    removeMemberMutation.isPending && removeMemberMutation.variables === m.user_id
                  const promoting =
                    roleMutation.isPending && roleMutation.variables?.userId === m.user_id
                  const isLastAdmin = m.role === 'admin' && adminCount === 1
                  return (
                    <li key={m.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{m.user_name}</span>
                        {isMe && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({t('components.teamsSection.labels.you')})
                          </span>
                        )}
                      </div>
                      <RoleBadge role={m.role} />
                      {isAdmin && !isMe && (
                        <div className="flex shrink-0 items-center gap-1">
                          {m.role === 'member' ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                              disabled={promoting}
                              onClick={() =>
                                roleMutation.mutate({ userId: m.user_id, role: 'admin' })
                              }
                            >
                              {promoting && <Spinner size="sm" className="mr-1 h-3 w-3" />}
                              {t('components.teamsSection.actions.promote')}
                            </Button>
                          ) : (
                            !isLastAdmin && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                disabled={promoting}
                                onClick={() =>
                                  roleMutation.mutate({ userId: m.user_id, role: 'member' })
                                }
                              >
                                {promoting && <Spinner size="sm" className="mr-1 h-3 w-3" />}
                                {t('components.teamsSection.actions.demote')}
                              </Button>
                            )
                          )}
                          {!isLastAdmin &&
                            (removingThis ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled
                              >
                                <Spinner size="sm" className="h-3 w-3" />
                              </Button>
                            ) : (
                              <ConfirmButton
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onConfirm={() => removeMemberMutation.mutate(m.user_id)}
                                icon={<UserMinus className="h-3 w-3" />}
                                tooltip={t('components.teamsSection.actions.removeMember')}
                              />
                            ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {canLeave && (
              <ConfirmButton
                type="button"
                variant="ghost"
                size="sm"
                onConfirm={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending}
                icon={<LogOut className="mr-1 h-3 w-3" />}
                tooltip={t('components.teamsSection.dialogs.leaveDescription')}
              >
                {t('components.teamsSection.actions.leave')}
              </ConfirmButton>
            )}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InviteLinkSection({ teamId }: { teamId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const invitesQuery = useQuery<ApiTeamInvite[]>({
    queryKey: teamInvitesKey(teamId),
    queryFn: () => api.listTeamInvites(teamId),
  })
  const invites = invitesQuery.data ?? []

  const createMutation = useMutation({
    mutationFn: () => api.createTeamInvite(teamId),
    onSuccess: () => {
      toast.success(t('components.teamsSection.toasts.inviteCreated'))
      queryClient.invalidateQueries({ queryKey: teamInvitesKey(teamId) })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.createInviteFailed'),
      ),
  })

  const revokeMutation = useMutation({
    mutationFn: (token: string) => api.deleteTeamInvite(teamId, token),
    onSuccess: () => {
      toast.success(t('components.teamsSection.toasts.inviteRevoked'))
      queryClient.invalidateQueries({ queryKey: teamInvitesKey(teamId) })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamsSection.errors.revokeInviteFailed'),
      ),
  })

  function urlFor(token: string): string {
    return `${window.location.origin}/invite/${token}`
  }

  const revokingToken = revokeMutation.isPending ? (revokeMutation.variables ?? null) : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('components.teamsSection.labels.invites')}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Spinner size="sm" className="h-3 w-3" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          {t('components.teamsSection.actions.newInvite')}
        </Button>
      </div>

      {invites.length === 0 ? (
        <p className="rounded-lg bg-foreground/[0.03] px-3 py-3 text-xs text-muted-foreground">
          {t('components.teamsSection.labels.noInvites')}
        </p>
      ) : (
        <ul className="divide-y divide-foreground/5 rounded-lg bg-foreground/[0.03]">
          {invites.map((inv) => {
            const url = urlFor(inv.token)
            const expires = inv.expires_at
              ? t('components.teamsSection.labels.expiresAt', {
                  value: new Date(inv.expires_at).toLocaleDateString(),
                })
              : null
            const revokingThis = revokingToken === inv.token
            return (
              <li key={inv.token} className="group/inv flex items-center gap-2 px-3 py-2 text-sm">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <code className="min-w-0 flex-1 truncate font-mono text-tiny text-muted-foreground">
                  {url}
                </code>
                {expires && (
                  <span className="shrink-0 text-tiny text-muted-foreground/70">{expires}</span>
                )}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/inv:opacity-100 focus-within:opacity-100">
                  <CopyButton value={url} className="text-muted-foreground hover:text-foreground" />
                  {revokingThis ? (
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled>
                      <Spinner size="sm" className="h-3 w-3" />
                    </Button>
                  ) : (
                    <ConfirmButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onConfirm={() => revokeMutation.mutate(inv.token)}
                      icon={<Trash2 className="h-3 w-3" />}
                      tooltip={t('components.teamsSection.dialogs.revokeInviteDescription')}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-tiny text-muted-foreground/70">
        {t('components.teamsSection.labels.inviteHelp')}
      </p>
    </div>
  )
}

function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setError(null)
    }
  }, [open])

  const createMutation = useMutation({
    mutationFn: () =>
      api.createTeam({
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (team) => {
      toast.success(t('components.teamsSection.toasts.created'))
      queryClient.invalidateQueries({ queryKey: teamsKey })
      onOpenChange(false)
      onCreated(team.id)
    },
    onError: (err) =>
      setError(
        err instanceof Error ? err.message : t('components.teamsSection.errors.createFailed'),
      ),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return
    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {t('components.teamsSection.dialogs.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">{t('components.teamsSection.fields.name')}</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('components.teamsSection.fields.namePlaceholder')}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-desc">{t('components.teamsSection.fields.description')}</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('components.teamsSection.fields.descriptionPlaceholder')}
              rows={3}
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={createMutation.isPending}
              type="submit"
              label={t('common.create')}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleBadge({ role }: { role: TeamRole }) {
  const { t } = useTranslation()
  return (
    <span
      className={
        role === 'admin'
          ? 'inline-flex h-5 items-center rounded bg-primary/15 px-1.5 text-tiny font-medium uppercase tracking-wide text-primary'
          : 'inline-flex h-5 items-center rounded bg-foreground/[0.06] px-1.5 text-tiny font-medium uppercase tracking-wide text-muted-foreground'
      }
    >
      {role === 'admin'
        ? t('components.teamsSection.labels.admin')
        : t('components.teamsSection.labels.member')}
    </span>
  )
}
