import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { AppHeaderSlotContext, useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { TeamworkTimeline } from '@/components/teamwork/TeamworkTimeline'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { ConfirmButton } from '@/components/ui/confirm-button'
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
import { WorkspaceChatPanel } from '@/components/workspace/WorkspaceChatPanel'
import { WorkspaceFilesPanel } from '@/components/workspace/WorkspaceFilesPanel'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { api } from '@/lib/api/client'
import type {
  ApiTeamworkParticipant,
  ApiTeamworkRosterCandidate,
  ApiTeamworkTask,
  Workspace,
} from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { cn } from '@/lib/utils'
import { AgentSessionProvider } from '@/stores/AgentSessionContext'
import type { ChatMessage } from '@/stores/agent-session-store'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Crown, Network, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const tasksKey = ['teamwork', 'tasks'] as const
const participantsKey = (id: string) => ['teamwork', 'tasks', id, 'participants'] as const
const ownWorkspacesKey = ['teamwork', 'own-workspaces'] as const
const candidatesKey = ['teamwork', 'roster-candidates'] as const
const taskKey = (id: string) => ['teamwork', 'task', id] as const

export function TeamworkSection({ instanceId }: { instanceId: string }) {
  const [activeTaskId, setActiveTaskId] = useInstancePersistentState<string | null>(
    instanceId,
    'activeTaskId',
    () => null,
  )

  if (activeTaskId) {
    return (
      <TaskDetailView
        instanceId={instanceId}
        taskId={activeTaskId}
        onBack={() => setActiveTaskId(null)}
        onDeleted={() => setActiveTaskId(null)}
      />
    )
  }
  return <TaskListView onOpen={(id) => setActiveTaskId(id)} />
}

// ── List view (full window) ────────────────────────────────────────────────

function TaskListView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const { data: tasks = [], isLoading } = useQuery<ApiTeamworkTask[]>({
    queryKey: tasksKey,
    queryFn: () => api.listTeamworkTasks(),
  })

  const { data: candidates = [] } = useQuery<ApiTeamworkRosterCandidate[]>({
    queryKey: candidatesKey,
    queryFn: () => api.listTeamworkRosterCandidates(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTeamworkTask(id),
    onSuccess: () => {
      toast.success(t('components.teamworkSection.toasts.deleted'))
      queryClient.invalidateQueries({ queryKey: tasksKey })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.deleteFailed'),
      ),
  })
  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  const coordinatorName = (workspaceId: string) =>
    candidates.find((a) => a.id === workspaceId)?.name ?? `${workspaceId.slice(0, 8)}…`

  return (
    <>
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.teamworkSection.actions.new')}
            onClick={() => setCreateOpen(true)}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <ResourceGrid>
            {tasks.map((task) => {
              const deleting = deletingId === task.id
              return (
                <ResourceCard
                  key={task.id}
                  name={task.name}
                  description={task.brief || undefined}
                  meta={
                    <span className="text-xs">
                      {t('components.teamworkSection.labels.coordinatorMeta', {
                        name: coordinatorName(task.coordinator_workspace_id),
                      })}
                    </span>
                  }
                  onClick={() => onOpen(task.id)}
                  actions={
                    deleting ? (
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
                        onConfirm={() => deleteMutation.mutate(task.id)}
                        icon={<Trash2 className="h-3 w-3" />}
                        tooltip={t('components.teamworkSection.actions.delete')}
                      />
                    )
                  }
                />
              )
            })}
          </ResourceGrid>
        )}
      </div>

      <CreateTaskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => onOpen(id)}
      />
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
          <Network className="relative h-16 w-16 text-primary/70" strokeWidth={1.25} />
        </div>
      }
      title={t('components.teamworkSection.empty.title')}
      description={t('components.teamworkSection.empty.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.teamworkSection.actions.new')}
        </Button>
      }
    />
  )
}

// ── Create dialog ──────────────────────────────────────────────────────────

function CreateTaskDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [coordinatorId, setCoordinatorId] = useState('')

  const { data: ownWorkspaces = [] } = useQuery<Workspace[]>({
    queryKey: ownWorkspacesKey,
    queryFn: () => api.getWorkspaces(),
    enabled: open,
  })

  const reset = () => {
    setName('')
    setBrief('')
    setCoordinatorId('')
  }

  const create = useMutation({
    mutationFn: () =>
      api.createTeamworkTask({
        name: name.trim(),
        brief: brief.trim() || undefined,
        coordinator_workspace_id: coordinatorId,
      }),
    onSuccess: (task) => {
      toast.success(t('components.teamworkSection.toasts.created'))
      queryClient.invalidateQueries({ queryKey: tasksKey })
      reset()
      onClose()
      onCreated(task.id)
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.createFailed'),
      ),
  })

  const canSubmit = name.trim().length > 0 && coordinatorId.length > 0 && !create.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.teamworkSection.dialogs.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tw-name">{t('components.teamworkSection.fields.name')}</Label>
            <Input
              id="tw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('components.teamworkSection.fields.namePlaceholder')}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tw-brief">{t('components.teamworkSection.fields.brief')}</Label>
            <Textarea
              id="tw-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={t('components.teamworkSection.fields.briefPlaceholder')}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tw-coordinator">
              {t('components.teamworkSection.fields.coordinator')}
            </Label>
            <select
              id="tw-coordinator"
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">
                {t('components.teamworkSection.fields.coordinatorPlaceholder')}
              </option>
              {ownWorkspaces.map((ws) => {
                const notRunning = ws.status !== 'running'
                const label = [
                  ws.name,
                  ws.slug ? `(${ws.slug})` : '',
                  notRunning ? `— ${t('components.teamworkSection.labels.notRunning')}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <option key={ws.id} value={ws.id} disabled={notRunning}>
                    {label}
                  </option>
                )
              })}
            </select>
            <p className="text-xs text-muted-foreground">
              {t('components.teamworkSection.labels.coordinatorHint')}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('components.teamworkSection.actions.cancel')}
          </Button>
          <SaveButton
            type="button"
            onClick={() => create.mutate()}
            disabled={!canSubmit}
            isSaving={create.isPending}
            label={t('components.teamworkSection.actions.create')}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Detail view (full window) ──────────────────────────────────────────────

function TaskDetailView({
  instanceId,
  taskId,
  onBack,
  onDeleted,
}: {
  instanceId: string
  taskId: string
  onBack: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const headerSlot = useAppHeaderSlot()

  const { data: task, isLoading } = useQuery<ApiTeamworkTask>({
    queryKey: taskKey(taskId),
    queryFn: () => api.getTeamworkTask(taskId),
  })

  const { data: participants = [] } = useQuery<ApiTeamworkParticipant[]>({
    queryKey: participantsKey(taskId),
    queryFn: () => api.listTeamworkParticipants(taskId),
  })

  const { data: candidates = [] } = useQuery<ApiTeamworkRosterCandidate[]>({
    queryKey: candidatesKey,
    queryFn: () => api.listTeamworkRosterCandidates(),
  })

  const { data: workspaces = [] } = useWorkspaces()
  const coordinator = useMemo(
    () => (task ? workspaces.find((w) => w.id === task.coordinator_workspace_id) : undefined),
    [workspaces, task],
  )

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTeamworkTask(taskId),
    onSuccess: () => {
      toast.success(t('components.teamworkSection.toasts.deleted'))
      queryClient.invalidateQueries({ queryKey: tasksKey })
      onDeleted()
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.deleteFailed'),
      ),
  })

  // Coord chat messages — fed by WorkspaceChatPanel.onMessages so we can
  // derive sub-session links from call_agent tool calls without needing our
  // own subscription.
  const [coordMessages, setCoordMessages] = useState<ChatMessage[]>([])
  const memberSessions = useMemo(
    () => deriveMemberSessions(coordMessages, candidates),
    [coordMessages, candidates],
  )

  const [activeTab, setActiveTab] = useInstancePersistentState<string>(
    instanceId,
    `right-tab:${taskId}`,
    () => 'coord',
  )

  // If the previously-selected member tab disappears (coord session changed,
  // tool call dropped, etc.) fall back to the coord tab so we don't render
  // an empty pane.
  useEffect(() => {
    if (activeTab === 'coord') return
    if (memberSessions.some((m) => m.sessionId === activeTab)) return
    setActiveTab('coord')
  }, [activeTab, memberSessions, setActiveTab])

  const [briefDialogOpen, setBriefDialogOpen] = useState(false)

  if (isLoading || !task) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* App-window header: back arrow + delete confirm */}
      {headerSlot &&
        createPortal(
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={onBack}
              aria-label={t('components.teamworkSection.actions.back')}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <div className="min-w-0 max-w-[60%] truncate text-sm font-medium">{task.name}</div>
            <ConfirmButton
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onConfirm={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              icon={<Trash2 className="h-3 w-3" />}
              tooltip={t('components.teamworkSection.actions.delete')}
            />
            <div className="flex-1" />
          </>,
          headerSlot,
        )}

      {/* Left column — config */}
      <aside className="flex w-[360px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-4">
        <BriefSection task={task} onEdit={() => setBriefDialogOpen(true)} />
        <MembersSection
          taskId={taskId}
          task={task}
          participants={participants}
          candidates={candidates}
        />
        <AfsSection task={task} coordinator={coordinator} instanceId={instanceId} />
      </aside>

      {/* Right column — sessions */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {coordinator ? (
          <RightSessionsPane
            instanceId={instanceId}
            task={task}
            participants={participants}
            coordinator={coordinator}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            memberSessions={memberSessions}
            coordMessages={coordMessages}
            onCoordMessages={setCoordMessages}
            workspaces={workspaces}
            candidates={candidates}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Spinner size="sm" className="mr-2" />
            {t('common.loading')}
          </div>
        )}
      </main>

      <BriefEditDialog
        open={briefDialogOpen}
        onClose={() => setBriefDialogOpen(false)}
        task={task}
      />
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-medium text-muted-foreground">{children}</div>
}

// ── Brief: display + dialog edit ───────────────────────────────────────────

function BriefSection({
  task,
  onEdit,
}: {
  task: ApiTeamworkTask
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const brief = task.brief?.trim()
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <SectionHeading>{t('components.teamworkSection.labels.brief')}</SectionHeading>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={onEdit}
          aria-label={t('components.teamworkSection.actions.editBrief')}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
      {brief ? (
        <button
          type="button"
          className="block w-full rounded-md border bg-muted/40 p-3 text-left text-sm whitespace-pre-wrap cursor-pointer hover:bg-muted/60"
          onClick={onEdit}
        >
          {brief}
        </button>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-md border border-dashed p-3 text-left text-xs text-muted-foreground hover:bg-muted/40"
        >
          {t('components.teamworkSection.labels.noBrief')}
        </button>
      )}
    </section>
  )
}

function BriefEditDialog({
  open,
  onClose,
  task,
}: {
  open: boolean
  onClose: () => void
  task: ApiTeamworkTask
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(task.brief ?? '')

  // Re-seed when the dialog opens or the underlying task brief changes —
  // avoids stale draft showing up if the user closes without saving and
  // someone else updates the brief.
  useEffect(() => {
    if (open) setValue(task.brief ?? '')
  }, [open, task.brief])

  const save = useMutation({
    mutationFn: () => api.updateTeamworkTask(task.id, { brief: value.trim() ? value : null }),
    onSuccess: () => {
      toast.success(t('components.teamworkSection.toasts.briefSaved'))
      queryClient.invalidateQueries({ queryKey: taskKey(task.id) })
      queryClient.invalidateQueries({ queryKey: tasksKey })
      onClose()
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.saveBriefFailed'),
      ),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.teamworkSection.dialogs.editBriefTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tw-brief-edit">{t('components.teamworkSection.fields.brief')}</Label>
          <Textarea
            id="tw-brief-edit"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('components.teamworkSection.fields.briefPlaceholder')}
            rows={6}
            maxLength={2000}
            disabled={save.isPending}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('components.teamworkSection.actions.cancel')}
          </Button>
          <SaveButton
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            isSaving={save.isPending}
            label={t('components.teamworkSection.actions.saveBrief')}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Members section (relocated; same add/remove logic) ────────────────────

function MembersSection({
  taskId,
  task,
  participants,
  candidates,
}: {
  taskId: string
  task: ApiTeamworkTask
  participants: ApiTeamworkParticipant[]
  candidates: ApiTeamworkRosterCandidate[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pickWorkspaceId, setPickWorkspaceId] = useState('')

  const memberCandidates = useMemo(() => {
    const taken = new Set(participants.map((p) => p.workspace_id))
    taken.add(task.coordinator_workspace_id)
    return candidates.filter((a) => !taken.has(a.id))
  }, [candidates, participants, task])

  // Coordinator info pulled from the candidate roster so we can render its
  // row inline with members. Falls back gracefully if not in the list
  // (shouldn't happen since the user owns the coord workspace).
  const coordInfo = useMemo(
    () => candidates.find((c) => c.id === task.coordinator_workspace_id),
    [candidates, task.coordinator_workspace_id],
  )

  const addParticipant = useMutation({
    mutationFn: (wsId: string) => api.addTeamworkParticipant(taskId, wsId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: participantsKey(taskId) })
      setPickWorkspaceId('')
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.addFailed'),
      ),
  })

  const removeParticipant = useMutation({
    mutationFn: (wsId: string) => api.removeTeamworkParticipant(taskId, wsId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: participantsKey(taskId) })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.removeFailed'),
      ),
  })

  return (
    <section>
      <SectionHeading>
        {t('components.teamworkSection.labels.membersCount', {
          count: participants.length + (coordInfo ? 1 : 0),
        })}
      </SectionHeading>
      <ul className="space-y-1">
        {coordInfo && (
          <li className="flex items-center justify-between rounded-md border bg-primary/[0.04] px-2 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Crown className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate font-medium">{coordInfo.name}</span>
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  {t('components.teamworkSection.labels.coordinator')}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {coordInfo.slug ?? t('components.teamworkSection.labels.noSlug')} ·{' '}
                {coordInfo.visibility}
              </div>
            </div>
          </li>
        )}
        {participants.map((p) => (
          <li
            key={p.workspace_id}
            className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.workspace_name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {p.workspace_slug ?? t('components.teamworkSection.labels.noSlug')} ·{' '}
                {p.workspace_visibility}
              </div>
            </div>
            <ConfirmButton
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onConfirm={() => removeParticipant.mutate(p.workspace_id)}
              icon={<UserMinus className="h-3 w-3" />}
              tooltip={t('components.teamworkSection.actions.remove')}
            />
          </li>
        ))}
      </ul>
      {participants.length === 0 && (
        <div className="mt-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t('components.teamworkSection.labels.noMembers')}
        </div>
      )}

      <AddMemberRow
        taskId={taskId}
        candidates={memberCandidates}
        pickWorkspaceId={pickWorkspaceId}
        setPickWorkspaceId={setPickWorkspaceId}
        onAdd={(wsId) => addParticipant.mutate(wsId)}
        isAdding={addParticipant.isPending}
      />
    </section>
  )
}

// Single-row member picker. Own workspaces missing a slug remain selectable —
// picking one drops the "Add" button in favor of an inline slug input that
// PATCHes the workspace and adds it as a participant in one combined action.
// Cross-user no-slug candidates stay disabled (we can't fix someone else's
// slug), and notRunning ones are also disabled regardless of ownership.
function AddMemberRow({
  taskId,
  candidates,
  pickWorkspaceId,
  setPickWorkspaceId,
  onAdd,
  isAdding,
}: {
  taskId: string
  candidates: ApiTeamworkRosterCandidate[]
  pickWorkspaceId: string
  setPickWorkspaceId: (next: string) => void
  onAdd: (workspaceId: string) => void
  isAdding: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [slugDraft, setSlugDraft] = useState('')

  const picked = useMemo(
    () => candidates.find((c) => c.id === pickWorkspaceId) ?? null,
    [candidates, pickWorkspaceId],
  )
  const needsSlug = !!picked && picked.is_own && !picked.slug

  // Reset draft whenever selection changes so a stale slug input from a
  // previously-picked workspace never leaks into the next one.
  useEffect(() => {
    setSlugDraft('')
  }, [pickWorkspaceId])

  const setSlugAndAdd = useMutation({
    mutationFn: async ({ wsId, slug }: { wsId: string; slug: string }) => {
      await api.patchWorkspace(wsId, { slug })
      await api.addTeamworkParticipant(taskId, wsId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: candidatesKey })
      queryClient.invalidateQueries({ queryKey: participantsKey(taskId) })
      setPickWorkspaceId('')
      setSlugDraft('')
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t('components.teamworkSection.errors.setSlugFailed'),
      ),
  })

  const trimmedSlug = slugDraft.trim()
  const canSetAndAdd = trimmedSlug.length > 0 && !setSlugAndAdd.isPending && !!picked

  const options = useMemo<ComboboxOption[]>(
    () =>
      candidates.map((a) => {
        const noSlug = !a.slug
        const notRunning = a.status !== 'running'
        // Cross-user no-slug is disabled — we can't PATCH someone else's
        // workspace. Own no-slug stays selectable; picking it surfaces the
        // inline slug input next to the combobox.
        const disabled = (noSlug && !a.is_own) || notRunning
        const metaParts: string[] = []
        if (!a.is_own) metaParts.push(`@${a.owner}`)
        metaParts.push(a.visibility)
        if (a.slug) metaParts.push(a.slug)
        if (disabled) {
          metaParts.push(
            notRunning
              ? t('components.teamworkSection.labels.notRunning')
              : t('components.teamworkSection.labels.slugRequired'),
          )
        }
        return {
          value: a.id,
          label: a.name,
          description: metaParts.join(' · '),
          disabled,
        }
      }),
    [candidates, t],
  )

  return (
    <div className="mt-2 space-y-2">
      <Combobox
        options={options}
        value={pickWorkspaceId}
        onValueChange={setPickWorkspaceId}
        placeholder={t('components.teamworkSection.fields.addMemberPlaceholder')}
        className="h-8"
      />

      {picked &&
        (needsSlug ? (
          <div className="flex items-center gap-2">
            <Input
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              placeholder={t('components.teamworkSection.fields.slugPlaceholder')}
              className="h-8 min-w-0 flex-1 text-xs"
              disabled={setSlugAndAdd.isPending}
              autoFocus
              onKeyDown={(e) => {
                if (isCommitEnter(e) && canSetAndAdd) {
                  setSlugAndAdd.mutate({ wsId: picked.id, slug: trimmedSlug })
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canSetAndAdd}
              onClick={() => setSlugAndAdd.mutate({ wsId: picked.id, slug: trimmedSlug })}
            >
              <UserPlus className="mr-1 h-3 w-3" />
              {setSlugAndAdd.isPending
                ? t('components.teamworkSection.actions.saving')
                : t('components.teamworkSection.actions.setSlugAndAdd')}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onAdd(pickWorkspaceId)}
              disabled={isAdding}
            >
              <UserPlus className="mr-1 h-3 w-3" />
              {t('components.teamworkSection.actions.add')}
            </Button>
          </div>
        ))}
    </div>
  )
}

// ── AFS section (embedded files panel scoped to the team's share) ─────────

function AfsSection({
  task,
  coordinator,
  instanceId,
}: {
  task: ApiTeamworkTask
  coordinator: Workspace | undefined
  instanceId: string
}) {
  const { t } = useTranslation()
  // Carve out a teamwork-specific files-panel instance so the panel's
  // persistent state (drive, viewingPath, sort) doesn't bleed into / from the
  // regular Files app. Keyed on task.id so each task remembers its own view.
  const filesInstanceId = `${instanceId}:teamwork-files:${task.id}`

  if (!task.afs_share_id || !coordinator) {
    return (
      <section>
        <SectionHeading>{t('components.teamworkSection.labels.sharedFolder')}</SectionHeading>
        <p className="text-xs text-muted-foreground">
          {t('components.teamworkSection.labels.sharedFolderPending')}
        </p>
      </section>
    )
  }

  return (
    <section className="flex min-h-[20rem] flex-1 flex-col">
      <SectionHeading>{t('components.teamworkSection.labels.sharedFolder')}</SectionHeading>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
        <LocalHeaderSlot variant="card">
          <AfsPanelSeed
            taskId={task.id}
            instanceId={filesInstanceId}
            workspaceId={coordinator.id}
          />
        </LocalHeaderSlot>
      </div>
    </section>
  )
}

// On first mount, point the embedded files panel at the team's afs share so
// the user lands inside `/team-<id>/`. Subsequent navigation is theirs.
// `lockedDrive="afs"` keeps the panel pinned to the AFS side and removes the
// Local/Cloud tabs from the header, which would otherwise be dead weight in
// the teamwork context.
function AfsPanelSeed({
  taskId,
  instanceId,
  workspaceId,
}: {
  taskId: string
  instanceId: string
  workspaceId: string
}) {
  const [path, setPath] = useInstancePersistentState<string>(instanceId, 'viewingPath', () => '/')
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (path === '/' || path === '') setPath(`/team-${taskId}/`)
  }, [path, setPath, taskId])

  return (
    <WorkspaceFilesPanel
      workspaceId={workspaceId}
      instanceId={instanceId}
      lockedDrive="afs"
      rootPath={`/team-${taskId}/`}
    />
  )
}

// ── Local header slot — redirects useAppHeaderSlot() to a sibling div ─────
//
// The chat / files panels portal their toolbars to whatever AppHeaderSlot
// they find via context. When embedded inside the teamwork detail those
// toolbars would otherwise compete with teamwork's own back/delete in the
// app-window header. Wrapping with LocalHeaderSlot pins each panel's portal
// target to a local row above its body.

function LocalHeaderSlot({
  children,
  variant = 'card',
}: {
  children: ReactNode
  variant?: 'card' | 'plain'
}) {
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null)
  // h-full (not flex-1) so this works when the parent is either a flex
  // container OR an absolute-positioned wrapper. Inside, we still use flex-1
  // for the body so the chat / files panel takes the remaining vertical space.
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col">
      <div
        ref={setSlotEl}
        className={cn(
          'flex h-9 shrink-0 items-center gap-1.5 px-2',
          variant === 'card' && 'border-b border-foreground/[0.06] bg-foreground/[0.04]',
        )}
      />
      <AppHeaderSlotContext.Provider value={slotEl}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </AppHeaderSlotContext.Provider>
    </div>
  )
}

// ── Right-side sessions pane (tabs + bodies) ──────────────────────────────

interface DerivedMemberSession {
  sessionId: string
  workspaceId: string
  slug: string
  workspaceName: string
  /** Order of first detection — used for tab stability + keys. */
  order: number
}

/**
 * Walk the coord chat's messages, find call_agent tool blocks whose result
 * parses as JSON with a session_id, and emit one entry per unique sub-
 * session. Slug→workspace mapping comes from the same callable-agents query
 * the picker already uses, so cross-user public agents are covered too.
 *
 * Best-effort: foreground-completed sub-sessions only show up because cp now
 * always wraps the result as JSON. If the caller agent hasn't completed yet,
 * the tool_result block isn't present yet and the member doesn't appear
 * until it does.
 */
function deriveMemberSessions(
  messages: ChatMessage[],
  candidates: ApiTeamworkRosterCandidate[],
): DerivedMemberSession[] {
  const out: DerivedMemberSession[] = []
  const seen = new Set<string>()
  let order = 0
  let toolBlocksSeen = 0
  let callAgentBlocksSeen = 0
  const toolNamesSeen: string[] = []
  for (const m of messages) {
    for (const block of m.blocks) {
      if (block.type !== 'tool') continue
      toolBlocksSeen++
      const tool = block.tool
      toolNamesSeen.push(tool.name)
      // Different host runtimes namespace the tool name differently. Seen
      // in the wild: `call_agent`, `mcp__tos-platform__call_agent`,
      // `Tool: tos-platform/call_agent`. Match any string ending in
      // `call_agent` with a non-identifier boundary in front.
      if (!/(^|[^A-Za-z0-9_])call_agent$/.test(tool.name)) continue
      callAgentBlocksSeen++
      // Some host runtimes wrap MCP tool calls as
      //   { server, tool, arguments: { slug, prompt, mode } }
      // others pass the args directly. Handle both.
      const rawArgs =
        tool.input && typeof tool.input === 'object' && 'arguments' in tool.input
          ? (tool.input as Record<string, unknown>).arguments
          : tool.input
      const args = (rawArgs as Record<string, unknown> | undefined) ?? {}
      const slugInput = typeof args.slug === 'string' ? (args.slug as string) : null
      if (!slugInput) {
        console.debug('[teamwork] call_agent tool block missing slug input', tool)
        continue
      }
      const result = tool.result
      if (result == null) {
        console.debug('[teamwork] call_agent result not yet available', {
          slug: slugInput,
          toolId: tool.id,
        })
        continue
      }
      // Result can be either the raw cp text return or wrapped in an MCP
      // envelope `{ content: [{ type: 'text', text: ... }] }`. Peel the
      // envelope first, then try to JSON-parse the inner text for session_id.
      let resultText: string
      if (typeof result === 'string') {
        try {
          const outer = JSON.parse(result)
          if (
            outer &&
            Array.isArray(outer.content) &&
            outer.content[0]?.type === 'text' &&
            typeof outer.content[0].text === 'string'
          ) {
            resultText = outer.content[0].text as string
          } else {
            resultText = result
          }
        } catch {
          resultText = result
        }
      } else if (result && typeof result === 'object') {
        const env = result as { content?: Array<{ type?: string; text?: string }> }
        if (
          Array.isArray(env.content) &&
          env.content[0]?.type === 'text' &&
          typeof env.content[0].text === 'string'
        ) {
          resultText = env.content[0].text
        } else {
          resultText = JSON.stringify(result)
        }
      } else {
        continue
      }

      let parsed: { session_id?: string } | null = null
      try {
        parsed = JSON.parse(resultText)
      } catch (e) {
        console.debug(
          '[teamwork] call_agent inner result not JSON — cp may not have the foreground-session_id change deployed',
          {
            slug: slugInput,
            resultText,
            error: e,
          },
        )
        continue
      }
      const sid = parsed?.session_id
      if (!sid) {
        console.debug('[teamwork] call_agent result lacks session_id', { slug: slugInput, parsed })
        continue
      }
      if (seen.has(sid)) continue

      // Resolve slug → candidate. Cross-user slugs come as 'username/slug'.
      let candidate: ApiTeamworkRosterCandidate | null = null
      if (slugInput.includes('/')) {
        const [username, bareSlug] = slugInput.split('/')
        candidate = candidates.find((c) => c.owner === username && c.slug === bareSlug) ?? null
      } else {
        candidate = candidates.find((c) => c.is_own && c.slug === slugInput) ?? null
      }
      if (!candidate) {
        console.debug('[teamwork] call_agent slug not resolved to a candidate', {
          slug: slugInput,
          candidateCount: candidates.length,
          candidateSlugs: candidates.map((c) => `${c.is_own ? '' : `${c.owner}/`}${c.slug}`),
        })
        continue
      }

      seen.add(sid)
      out.push({
        sessionId: sid,
        workspaceId: candidate.id,
        slug: slugInput,
        workspaceName: candidate.name,
        order: order++,
      })
    }
  }
  console.debug('[teamwork] deriveMemberSessions', {
    messageCount: messages.length,
    toolBlocksSeen,
    toolNamesSeen,
    callAgentBlocksSeen,
    detected: out.length,
    out,
  })
  return out
}

function RightSessionsPane({
  instanceId,
  task,
  participants,
  coordinator,
  activeTab,
  setActiveTab,
  memberSessions,
  coordMessages,
  onCoordMessages,
  workspaces,
  candidates,
}: {
  instanceId: string
  task: ApiTeamworkTask
  participants: ApiTeamworkParticipant[]
  coordinator: Workspace
  activeTab: string
  setActiveTab: (next: string) => void
  memberSessions: DerivedMemberSession[]
  coordMessages: ChatMessage[]
  onCoordMessages: (messages: ChatMessage[]) => void
  workspaces: Workspace[]
  candidates: ApiTeamworkRosterCandidate[]
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TeamworkTimeline
        coordMessages={coordMessages}
        candidates={candidates}
        coordinatorName={coordinator.name}
        activeLane={activeTab}
        onLaneSelect={setActiveTab}
      />

      {/* Coord always mounted (we depend on its onMessages); members mount on demand. */}
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0', activeTab !== 'coord' && 'invisible')}>
          <CoordSessionPanel
            instanceId={instanceId}
            task={task}
            participants={participants}
            coordinator={coordinator}
            onMessages={onCoordMessages}
          />
        </div>
        {memberSessions
          .filter((m) => m.sessionId === activeTab)
          .map((m) => {
            const ws = resolveMemberWorkspace(m.workspaceId, workspaces, candidates)
            if (!ws) return null
            return (
              <div key={m.sessionId} className="absolute inset-0">
                <MemberSessionPanel workspace={ws} sessionId={m.sessionId} />
              </div>
            )
          })}
      </div>
    </div>
  )
}

// ── Coord session body ────────────────────────────────────────────────────

// Wraps task metadata in an XML block appended after the user's text. XML
// boundaries are easier for the model to skip when echoing the user's input
// back, and putting it after the user message keeps the user's own request
// as the lead-in rather than buried under preamble.
function buildTeamworkContext(
  task: ApiTeamworkTask,
  participants: ApiTeamworkParticipant[],
): string {
  const callable = participants.filter((p) => p.workspace_slug)
  const lines: string[] = ['<task_context>', `  <name>${task.name}</name>`]
  const brief = task.brief?.trim()
  if (brief) {
    lines.push('  <description>')
    lines.push(brief)
    lines.push('  </description>')
  }
  lines.push(`  <shared_folder>/mnt/afs/team-${task.id}</shared_folder>`)
  if (callable.length) {
    lines.push('  <members>')
    for (const p of callable) lines.push(`    <member slug="${p.workspace_slug}" />`)
    lines.push('  </members>')
  } else {
    lines.push('  <members />')
  }
  lines.push('</task_context>')
  return lines.join('\n')
}

function CoordSessionPanel({
  instanceId,
  task,
  participants,
  coordinator,
  onMessages,
}: {
  instanceId: string
  task: ApiTeamworkTask
  participants: ApiTeamworkParticipant[]
  coordinator: Workspace
  onMessages: (messages: ChatMessage[]) => void
}) {
  const [activeSessionId, setActiveSessionId] = useInstancePersistentState<string | null>(
    instanceId,
    `coord-session:${task.id}`,
    () => null,
  )
  const persistSession = useCallback(
    (sid: string | undefined) => setActiveSessionId(sid ?? null),
    [setActiveSessionId],
  )
  const registerSession = useCallback(
    (sessionId: string) => {
      api
        .registerTeamworkSession(task.id, { session_id: sessionId, role: 'coordinator' })
        .catch((err) => {
          console.error('[teamwork] failed to register coord session', err)
        })
    },
    [task.id],
  )
  const transformFirstMessage = useCallback(
    (text: string) => `${text}\n\n${buildTeamworkContext(task, participants)}`,
    [task, participants],
  )

  return (
    <LocalHeaderSlot variant="plain">
      <AgentSessionProvider
        key={`${task.id}:${coordinator.id}`}
        workspaceId={coordinator.id}
        workspaceName={coordinator.name}
        initialSessionId={activeSessionId ?? undefined}
        initialContext={{}}
        syncSessionToUrl={persistSession}
        onSessionCreated={registerSession}
        chatEndpoint={`/api/teamwork/${task.id}/chat`}
      >
        <WorkspaceChatPanel
          workspace={coordinator}
          transformFirstMessage={transformFirstMessage}
          onMessages={onMessages}
        />
      </AgentSessionProvider>
    </LocalHeaderSlot>
  )
}

// ── Member session body (readonly) ────────────────────────────────────────

function MemberSessionPanel({
  workspace,
  sessionId,
}: {
  workspace: Workspace
  sessionId: string
}) {
  return (
    <LocalHeaderSlot variant="plain">
      <AgentSessionProvider
        key={`${workspace.id}:${sessionId}`}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        initialSessionId={sessionId}
        initialContext={{}}
        syncSessionToUrl={NOOP_SYNC}
      >
        <WorkspaceChatPanel workspace={workspace} readonly />
      </AgentSessionProvider>
    </LocalHeaderSlot>
  )
}

const NOOP_SYNC = () => {}

/**
 * Find the Workspace object backing a member session. Cross-user public
 * agents aren't returned by `useWorkspaces()` (which is scoped to the user's
 * own list), so we synthesize a minimal object from the roster-candidate
 * row when needed. Chat panel only really uses id + name.
 */
function resolveMemberWorkspace(
  workspaceId: string,
  workspaces: Workspace[],
  candidates: ApiTeamworkRosterCandidate[],
): Workspace | null {
  const own = workspaces.find((w) => w.id === workspaceId)
  if (own) return own
  const candidate = candidates.find((c) => c.id === workspaceId)
  if (!candidate) return null
  return {
    id: candidate.id,
    name: candidate.name,
    slug: candidate.slug,
    visibility: candidate.visibility,
    is_system: false,
    owner: candidate.owner,
    status: candidate.status,
    created_at: '',
    tag_ids: [],
    active_agent_sessions: 0,
    active_human_sessions: 0,
    active_sessions: [],
    rebuild_available: false,
  }
}
