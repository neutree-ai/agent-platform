import { ResourceCard } from '@/components/resource/ResourceCard'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CommandDialog } from '@/components/workspace/CommandDialog'
import { ScheduleDialog } from '@/components/workspace/ScheduleDialog'
import {
  useCommands,
  useDeleteCommand,
  useSetCommandDisabled,
  useUpdateCommand,
} from '@/hooks/useCommands'
import {
  useDeleteSchedule,
  useRunSchedule,
  useSchedules,
  useUpdateSchedule,
} from '@/hooks/useSchedules'
import type { Schedule, WorkspaceCommand } from '@/lib/api/types'
import { describeCron } from '@/lib/cron-describe'
import { commandsRefresh, schedulesRefresh } from '@/plugins/builder-mode'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  Library,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Category = 'schedules' | 'commands'

// ─── Time helpers ────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.max(seconds, 1)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function previewText(text: string | null | undefined): string {
  if (!text) return ''
  // Collapse whitespace so the 2-line clamp shows actual content rather than
  // blank lines at the top of a multi-paragraph prompt.
  return text.replace(/\s+/g, ' ').trim()
}

// ─── Schedule card ──────────────────────────────────────────────

function ScheduleCard({
  workspaceId,
  schedule,
  onEdit,
  onFork,
}: {
  workspaceId: string
  schedule: Schedule
  onEdit: () => void
  onFork: () => void
}) {
  const { t, i18n } = useTranslation()
  const updateMutation = useUpdateSchedule(workspaceId)
  const deleteMutation = useDeleteSchedule(workspaceId)
  const runMutation = useRunSchedule(workspaceId)
  const onError = (err: Error) => toast.error(err.message)
  const isTemplate = schedule.origin === 'template'

  const promptPreview = previewText(schedule.prompt_content ?? schedule.prompt)
  const lastRun = schedule.last_run_at
    ? t('components.automation.lastRun', { value: timeAgo(schedule.last_run_at) })
    : null
  // Tri-state status chip in the type slot. Icon + label + soft-tinted bg
  // triple-encode the schedule's kind so the cards are scannable at a glance
  // (info = recurring, warning = upcoming one-time, muted = completed).
  let chipVariant: 'info-soft' | 'warning-soft' | 'muted-soft'
  let ChipIcon: typeof Repeat
  let scheduleLabel: string
  if (schedule.run_at) {
    const ts = new Date(schedule.run_at).toLocaleString(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    if (schedule.completed_at) {
      chipVariant = 'muted-soft'
      ChipIcon = CheckCircle2
      scheduleLabel = t('components.configSchedules.form.ranAt', { time: ts })
    } else {
      chipVariant = 'warning-soft'
      ChipIcon = CalendarClock
      scheduleLabel = t('components.configSchedules.form.willRunAt', { time: ts })
    }
  } else {
    chipVariant = 'info-soft'
    ChipIcon = Repeat
    scheduleLabel = describeCron(schedule.cron ?? '', i18n.language) ?? schedule.cron ?? ''
  }

  const typeChip = (
    <Badge
      variant={chipVariant}
      className="gap-1 rounded-md px-1.5 py-0 font-normal text-[11px] leading-5"
    >
      <ChipIcon className="h-3 w-3" strokeWidth={2} />
      <span className="truncate">{scheduleLabel}</span>
    </Badge>
  )

  return (
    <ResourceCard
      name={schedule.name}
      description={promptPreview || undefined}
      type={
        isTemplate ? (
          <span className="flex items-center gap-1.5">
            {typeChip}
            <Badge
              variant="muted-soft"
              className="rounded-md px-1.5 py-0 font-normal text-[11px] leading-5"
            >
              {t('components.automation.badges.template')}
            </Badge>
          </span>
        ) : (
          typeChip
        )
      }
      meta={[schedule.timezone, lastRun].filter(Boolean).join(' · ') || undefined}
      body={
        <div
          // Stop propagation so toggling the switch doesn't open the editor.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          {schedule.completed_at ? (
            <span>{t('components.configSchedules.form.completed')}</span>
          ) : (
            <>
              <Switch
                checked={schedule.enabled}
                onCheckedChange={() =>
                  updateMutation.mutate(
                    { id: schedule.id, enabled: !schedule.enabled },
                    {
                      onSuccess: () =>
                        toast.success(t('components.configSchedules.toasts.updated')),
                      onError,
                    },
                  )
                }
                className="scale-75"
              />
              <span>
                {schedule.enabled
                  ? t('components.automation.editor.enabled')
                  : t('components.automation.editor.disabled')}
              </span>
            </>
          )}
        </div>
      }
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            disabled={runMutation.isPending}
            title={t('components.automation.actions.runNow')}
            onClick={() =>
              runMutation.mutate(schedule.id, {
                onSuccess: () => toast.success(t('components.automation.toasts.runEnqueued')),
                onError,
              })
            }
          >
            {runMutation.isPending ? <Spinner size="sm" /> : <Play className="h-3 w-3" />}
          </Button>
          {isTemplate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title={t('components.automation.actions.fork')}
              onClick={onFork}
            >
              <Copy className="h-3 w-3" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title={t('components.configSchedules.actions.edit') ?? t('common.edit')}
                onClick={onEdit}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <ConfirmButton
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                disabled={deleteMutation.isPending}
                onConfirm={() =>
                  deleteMutation.mutate(schedule.id, {
                    onSuccess: () => toast.success(t('components.configSchedules.toasts.deleted')),
                    onError,
                  })
                }
                icon={<Trash2 className="h-3 w-3" />}
                tooltip={t('components.configCommands.actions.delete')}
              />
            </>
          )}
        </>
      }
      onClick={isTemplate ? undefined : onEdit}
    />
  )
}

// ─── Command card ───────────────────────────────────────────────

function CommandCard({
  workspaceId,
  command,
  onEdit,
  onFork,
}: {
  workspaceId: string
  command: WorkspaceCommand
  onEdit: () => void
  onFork: () => void
}) {
  const { t } = useTranslation()
  const deleteMutation = useDeleteCommand(workspaceId)
  const setDisabled = useSetCommandDisabled(workspaceId)
  const updateMutation = useUpdateCommand(workspaceId)
  const onError = (err: Error) => toast.error(err.message)

  const contentPreview = previewText(command.prompt_content ?? command.content)
  const isTemplate = command.source === 'template'
  const typeLabel = t(`components.configCommands.types.${command.type}`)

  return (
    <ResourceCard
      name={<span className="font-mono">/{command.name}</span>}
      description={contentPreview || undefined}
      type={
        isTemplate ? (
          <span className="flex items-center gap-1.5">
            {typeLabel}
            <Badge
              variant="muted-soft"
              className="rounded-md px-1.5 py-0 font-normal text-[11px] leading-5"
            >
              {t('components.automation.badges.template')}
            </Badge>
          </span>
        ) : (
          typeLabel
        )
      }
      typeIcon={command.prompt_id ? Library : undefined}
      body={
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Switch
            checked={!command.disabled}
            onCheckedChange={(checked) => {
              const opts = {
                onSuccess: () => toast.success(t('components.configCommands.toasts.updated')),
                onError,
              }
              // Template commands toggle a name-keyed marker; local commands flip
              // their own row.
              if (isTemplate) {
                setDisabled.mutate({ name: command.name, disabled: !checked }, opts)
              } else {
                updateMutation.mutate({ id: command.id, disabled: !checked }, opts)
              }
            }}
            className="scale-75"
          />
          <span>
            {command.disabled
              ? t('components.automation.editor.disabled')
              : t('components.automation.editor.enabled')}
          </span>
        </div>
      }
      actions={
        isTemplate ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title={t('components.automation.actions.fork')}
            onClick={onFork}
          >
            <Copy className="h-3 w-3" />
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title={t('common.edit')}
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <ConfirmButton
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              disabled={deleteMutation.isPending}
              onConfirm={() =>
                deleteMutation.mutate(command.id, {
                  onSuccess: () => toast.success(t('components.configCommands.toasts.deleted')),
                  onError,
                })
              }
              icon={<Trash2 className="h-3 w-3" />}
              tooltip={t('components.configCommands.actions.delete')}
            />
          </>
        )
      }
      onClick={isTemplate ? undefined : onEdit}
    />
  )
}

// ─── Main panel ─────────────────────────────────────────────────

interface WorkspaceAutomationPanelProps {
  workspaceId: string
  instanceId: string
}

export function WorkspaceAutomationPanel({
  workspaceId,
  instanceId,
}: WorkspaceAutomationPanelProps) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const { data: schedules, isLoading: schedulesLoading } = useSchedules(workspaceId)
  const { data: commands, isLoading: commandsLoading } = useCommands(workspaceId)

  // Agent-driven auto-refresh: builder-mode plugin bumps when the matching
  // `workspace_schedule_*_apply` / `workspace_command_*_apply` tool completes.
  const schedulesToken = schedulesRefresh.useToken()
  const commandsToken = commandsRefresh.useToken()
  const qc = useQueryClient()
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on token change
  useEffect(() => {
    if (schedulesToken === 0) return
    qc.invalidateQueries({ queryKey: ['schedules', workspaceId] })
  }, [schedulesToken])
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on token change
  useEffect(() => {
    if (commandsToken === 0) return
    qc.invalidateQueries({ queryKey: ['commands', workspaceId] })
  }, [commandsToken])

  const [category, setCategory] = useInstancePersistentState<Category>(
    instanceId,
    'category',
    () => 'schedules',
  )
  // Which entity is currently being edited (or 'new' for create). Local —
  // dialog open/close is a transient UI concern, not worth persisting.
  const [editingScheduleId, setEditingScheduleId] = useState<string | 'new' | null>(null)
  const [editingCommandId, setEditingCommandId] = useState<string | 'new' | null>(null)
  // Forking a template item opens the dialog in create mode prefilled from it.
  const [forkingSchedule, setForkingSchedule] = useState<Schedule | null>(null)
  const [forkingCommand, setForkingCommand] = useState<WorkspaceCommand | null>(null)

  const isLoading = schedulesLoading || commandsLoading
  const scheduleCount = schedules?.length ?? 0
  const commandCount = commands?.length ?? 0
  const empty = category === 'schedules' ? scheduleCount === 0 : commandCount === 0

  const editingSchedule =
    editingScheduleId && editingScheduleId !== 'new'
      ? schedules?.find((s) => s.id === editingScheduleId)
      : undefined
  const editingCommand =
    editingCommandId && editingCommandId !== 'new'
      ? commands?.find((c) => c.id === editingCommandId)
      : undefined

  const openCreate = () => {
    if (category === 'schedules') setEditingScheduleId('new')
    else setEditingCommandId('new')
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <Tabs
              value={category}
              onValueChange={(v) => setCategory(v as Category)}
              className="shrink-0"
            >
              <TabsList className="h-7 p-0.5" aria-label={t('components.automation.tabsLabel')}>
                <TabsTrigger value="schedules" className="h-6 gap-1.5 px-2 text-xs">
                  {t('components.automation.sections.schedules')}
                  <span className="tabular-nums text-muted-foreground/70">{scheduleCount}</span>
                </TabsTrigger>
                <TabsTrigger value="commands" className="h-6 gap-1.5 px-2 text-xs">
                  {t('components.automation.sections.commands')}
                  <span className="tabular-nums text-muted-foreground/70">{commandCount}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <AppHeaderButton
              icon={Plus}
              label={
                category === 'schedules'
                  ? t('components.automation.actions.newSchedule')
                  : t('components.automation.actions.newCommand')
              }
              onClick={openCreate}
            />
          </>,
          headerSlot,
        )}

      <ScheduleDialog
        workspaceId={workspaceId}
        open={editingScheduleId !== null || forkingSchedule !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditingScheduleId(null)
            setForkingSchedule(null)
          }
        }}
        schedule={forkingSchedule ? undefined : editingSchedule}
        forkInitial={forkingSchedule ?? undefined}
      />
      <CommandDialog
        workspaceId={workspaceId}
        open={editingCommandId !== null || forkingCommand !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditingCommandId(null)
            setForkingCommand(null)
          }
        }}
        command={forkingCommand ? undefined : editingCommand}
        forkInitial={forkingCommand ?? undefined}
      />

      <div className="flex h-full min-h-0 flex-col">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            <Spinner size="sm" className="mr-1.5" />
            {t('common.loading')}
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center">
            <EmptyHero
              illustration={
                <EmptyIllustration
                  src={category === 'schedules' ? 'schedules' : 'commands'}
                  size="h-32"
                />
              }
              title={t(`components.automation.empty.${category}.title`)}
              description={t(`components.automation.empty.${category}.description`)}
              action={
                <Button type="button" size="sm" variant="outline" onClick={openCreate}>
                  <Plus className="mr-1 h-3 w-3" />
                  {category === 'schedules'
                    ? t('components.automation.actions.newSchedule')
                    : t('components.automation.actions.newCommand')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
              {category === 'schedules'
                ? schedules?.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      workspaceId={workspaceId}
                      schedule={s}
                      onEdit={() => setEditingScheduleId(s.id)}
                      onFork={() => setForkingSchedule({ ...s, name: `${s.name}-copy` })}
                    />
                  ))
                : commands?.map((c) => (
                    <CommandCard
                      key={c.id}
                      workspaceId={workspaceId}
                      command={c}
                      onEdit={() => setEditingCommandId(c.id)}
                      onFork={() => setForkingCommand({ ...c, name: `${c.name}-copy` })}
                    />
                  ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
