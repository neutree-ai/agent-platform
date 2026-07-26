import { PromptEditor } from '@/components/PromptEditor'
import { PromptViewer } from '@/components/prompt/PromptViewer'
import { MasterSidebar } from '@/components/shell/master-sidebar/MasterSidebar'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DiffView } from '@/components/ui/diff-view'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/AuthContext'
import {
  useCreatePrompt,
  useDeletePrompt,
  usePromptVersions,
  usePrompts,
  useRollbackPrompt,
  useSetDefaultPrompt,
  useUpdatePrompt,
} from '@/hooks/usePrompts'
import type { ApiPrompt, ApiPromptVersion, PromptVisibility } from '@/lib/api/types'
import { promptLibraryRefresh } from '@/plugins/builder-mode'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useQueryClient } from '@tanstack/react-query'
import {
  Copy,
  Globe,
  Lock,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Scope = 'mine' | 'shared' | 'public'

const VISIBILITY_ICON: Record<PromptVisibility, typeof Lock> = {
  private: Lock,
  team: Users,
  public: Globe,
}

export function PromptsSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { prompts } = usePrompts()
  const headerSlot = useAppHeaderSlot()

  // Agent-driven auto-refresh: builder-mode plugin bumps when
  // prompt_create_apply / prompt_update_apply / prompt_delete_apply completes.
  const promptLibraryToken = promptLibraryRefresh.useToken()
  const qc = useQueryClient()
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on token change
  useEffect(() => {
    if (promptLibraryToken === 0) return
    qc.invalidateQueries({ queryKey: ['prompts'] })
  }, [promptLibraryToken])
  const [selectedId, setSelectedId] = useInstancePersistentState<string | null>(
    instanceId,
    'promptsSelectedId',
    () => null,
  )
  const [scope, setScope] = useInstancePersistentState<Scope>(
    instanceId,
    'promptsScope',
    () => 'mine',
  )
  const [search, setSearch] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const [versionsEnabled, setVersionsEnabled] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<ApiPromptVersion | null>(null)

  const createPromptMut = useCreatePrompt()
  const updatePromptMut = useUpdatePrompt()
  const deletePromptMut = useDeletePrompt()
  const setDefaultPromptMut = useSetDefaultPrompt()
  const rollbackPromptMut = useRollbackPrompt()

  const isSaving = createPromptMut.isPending || updatePromptMut.isPending

  const versionsQuery = usePromptVersions(selectedId, versionsEnabled)
  const versions = versionsQuery.data ?? []
  const versionsLoading = versionsQuery.isLoading

  const inScope = (p: ApiPrompt): boolean => {
    if (scope === 'mine') return p.is_own
    if (scope === 'shared') return !p.is_own && p.shared_via_teams.length > 0
    return p.visibility === 'public' && !p.is_own
  }
  const displayedPrompts = prompts
    .filter(inScope)
    .filter((p) => (search ? p.name.toLowerCase().includes(search.toLowerCase()) : true))

  const selectedPrompt = prompts.find((p) => p.id === selectedId) ?? null
  const isOwner = selectedPrompt?.is_own ?? false
  const canEditContent = isOwner || selectedPrompt?.my_permission === 'editor'

  useEffect(() => {
    setEditMode(false)
    setCreateMode(false)
    setVersionsEnabled(false)
    setPreviewVersion(null)
    setSaveError(null)
  }, [selectedId])

  const handleSelect = (id: string) => setSelectedId(id)

  function enterEditMode(prompt: ApiPrompt) {
    setEditName(prompt.name)
    setEditContent(prompt.content)
    setEditMode(true)
    setCreateMode(false)
    setSaveError(null)
    setVersionsEnabled(false)
    setPreviewVersion(null)
  }
  function enterCreateMode() {
    setSelectedId(null)
    setEditName('')
    setEditContent('')
    setEditMode(false)
    setCreateMode(true)
    setSaveError(null)
  }
  function cancelEdit() {
    setEditMode(false)
    setCreateMode(false)
    setSaveError(null)
    setPreviewVersion(null)
  }

  async function handleSave() {
    setSaveError(null)
    try {
      if (createMode) {
        const created = await createPromptMut.mutateAsync({
          name: editName.trim(),
          content: editContent,
          visibility: 'private',
        })
        setCreateMode(false)
        setSelectedId(created.id)
      } else if (editMode && selectedId) {
        await updatePromptMut.mutateAsync({
          id: selectedId,
          data: {
            name: editName.trim(),
            content: editContent,
          },
        })
        setEditMode(false)
      }
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t('components.promptEditor.errors.saveFailed'),
      )
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePromptMut.mutateAsync(id)
      toast.success(t('components.library.prompts.toasts.deleted'))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.library.prompts.errors.deleteFailed'),
      )
    }
  }

  async function handleFork(prompt: ApiPrompt) {
    const baseName = `${prompt.name} ${t('components.library.prompts.labels.copySuffix')}`
    for (let attempt = 0; attempt < 10; attempt++) {
      const name = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`
      try {
        const forked = await createPromptMut.mutateAsync({
          name,
          content: prompt.content,
          visibility: 'private',
        })
        toast.success(t('components.library.prompts.toasts.forked'))
        setSelectedId(forked.id)
        return
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('already exists')) continue
        toast.error(msg || t('components.library.prompts.errors.copyFailed'))
        return
      }
    }
    toast.error(t('components.library.prompts.errors.tooManyCopies'))
  }

  async function handleToggleDefault(promptId: string) {
    const isDefault = user?.default_prompt_id === promptId
    try {
      await setDefaultPromptMut.mutateAsync(isDefault ? null : promptId)
      await refreshUser()
      toast.success(
        isDefault
          ? t('components.library.prompts.toasts.defaultCleared')
          : t('components.library.prompts.toasts.defaultSet'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.errors.requestFailed'))
    }
  }

  async function handleRollback(promptId: string, version: number) {
    try {
      await rollbackPromptMut.mutateAsync({ id: promptId, version })
      toast.success(t('components.promptEditor.toasts.rolledBack', { version }))
      setEditMode(false)
      setPreviewVersion(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.promptEditor.errors.rollbackFailed'),
      )
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.library.prompts.actions.new')}
              onClick={enterCreateMode}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <SegmentedControl<Scope>
              mode="tabs"
              size="sm"
              value={scope}
              onValueChange={setScope}
              ariaLabel={t('components.library.prompts.scope.aria')}
              options={[
                { value: 'mine', label: t('components.library.prompts.scope.mine') },
                { value: 'shared', label: t('components.library.prompts.scope.shared') },
                { value: 'public', label: t('components.library.prompts.scope.public') },
              ]}
            />
          </>,
          headerSlot,
        )}

      {/* ── Left: Prompt List ── */}
      <MasterSidebar width="md">
        <MasterSidebar.Search value={search} onChange={setSearch} />
        <MasterSidebar.List>
          {displayedPrompts.length === 0 ? (
            search ? (
              <EmptyHero
                className="py-6"
                illustration={<EmptyIllustration src="search" size="h-20" />}
                title={t('components.workspaceChat.empty.noMatches')}
              />
            ) : (
              <EmptyHero
                className="py-6"
                illustration={<EmptyIllustration src="prompts" size="h-20" />}
                title={t('components.library.prompts.empty.noPrompts.title')}
                description={t('components.library.prompts.empty.noPrompts.description')}
                action={
                  scope === 'mine' && (
                    <Button type="button" size="sm" variant="outline" onClick={enterCreateMode}>
                      <Plus className="mr-1 h-3 w-3" />
                      {t('components.library.prompts.actions.new')}
                    </Button>
                  )
                }
              />
            )
          ) : (
            displayedPrompts.map((p) => {
              const VisIcon = VISIBILITY_ICON[p.visibility]
              return (
                <MasterSidebar.Item
                  key={p.id}
                  selected={selectedId === p.id}
                  onSelect={() => handleSelect(p.id)}
                  leading={
                    user?.default_prompt_id === p.id ? (
                      // Pin (not Star) marks the default prompt — the star is
                      // reserved platform-wide for favorites (e.g. sessions).
                      <Pin className="h-3 w-3 fill-primary/25 text-primary" />
                    ) : (
                      <VisIcon className="h-3 w-3 text-muted-foreground/60" />
                    )
                  }
                  trailing={
                    <span className="text-tiny tabular-nums text-muted-foreground/60">
                      v{p.current_version}
                    </span>
                  }
                >
                  {p.name}
                </MasterSidebar.Item>
              )
            })
          )}
        </MasterSidebar.List>
      </MasterSidebar>

      {/* ── Right: Detail / Edit ── */}
      {createMode || editMode ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-auto max-w-md border-0 bg-transparent px-0 text-sm font-semibold shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0"
              placeholder={t('components.promptEditor.placeholders.name')}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={cancelEdit}
                disabled={isSaving}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={isSaving || !editName.trim()}
              >
                {isSaving && <Spinner size="sm" className="mr-1" />}
                {t('common.save')}
              </Button>
            </div>
          </div>
          {saveError && (
            <div className="mx-5 mb-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </div>
          )}
          <div className="min-h-0 flex-1 px-5 pb-4">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="h-full w-full resize-none rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] p-4 font-mono text-xs shadow-none focus-visible:border-foreground/[0.12] focus-visible:bg-foreground/[0.05] focus-visible:ring-0"
              placeholder={t('components.promptEditor.placeholders.content')}
            />
          </div>
        </div>
      ) : selectedPrompt ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{selectedPrompt.name}</h2>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-normal">
                    {t(`components.promptEditor.visibility.${selectedPrompt.visibility}`)}
                  </Badge>
                  {!isOwner && (
                    <span>
                      {t('components.library.prompts.labels.byOwner', {
                        owner: selectedPrompt.owner_name,
                      })}
                    </span>
                  )}
                  {!isOwner && (
                    <Badge
                      variant="outline"
                      className={
                        selectedPrompt.my_permission === 'editor'
                          ? 'font-normal text-success'
                          : 'font-normal text-muted-foreground'
                      }
                    >
                      {t(
                        selectedPrompt.my_permission === 'editor'
                          ? 'components.library.prompts.badges.editable'
                          : 'components.library.prompts.badges.readOnly',
                      )}
                    </Badge>
                  )}
                  {isOwner && user?.default_prompt_id === selectedPrompt.id && (
                    <span>{t('components.library.prompts.labels.default')}</span>
                  )}
                </div>
              </div>
              <Select
                value={
                  previewVersion
                    ? String(previewVersion.version)
                    : String(selectedPrompt.current_version)
                }
                onValueChange={(val) => {
                  const ver = Number(val)
                  if (ver === selectedPrompt.current_version) {
                    setPreviewVersion(null)
                  } else {
                    const v = versions.find((x) => x.version === ver)
                    if (v) setPreviewVersion(v)
                  }
                }}
                onOpenChange={(open) => {
                  if (open && !versionsEnabled) setVersionsEnabled(true)
                }}
              >
                <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-foreground/[0.06] px-2 text-tiny shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versionsLoading ? (
                    <div className="flex justify-center py-2">
                      <Spinner size="sm" />
                    </div>
                  ) : versions.length === 0 ? (
                    <SelectItem value={String(selectedPrompt.current_version)} className="text-xs">
                      v{selectedPrompt.current_version}
                    </SelectItem>
                  ) : (
                    versions.map((v) => (
                      <SelectItem key={v.version} value={String(v.version)} className="text-xs">
                        v{v.version}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {previewVersion &&
                previewVersion.version !== selectedPrompt.current_version &&
                canEditContent && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleRollback(selectedPrompt.id, previewVersion.version)}
                  >
                    <RotateCcw className="h-3 w-3" />{' '}
                    {t('components.library.prompts.actions.rollbackTo', {
                      version: previewVersion.version,
                    })}
                  </Button>
                )}
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 hover:text-foreground ${
                    user?.default_prompt_id === selectedPrompt.id
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => handleToggleDefault(selectedPrompt.id)}
                  title={
                    user?.default_prompt_id === selectedPrompt.id
                      ? t('components.library.prompts.actions.clearDefault')
                      : t('components.library.prompts.actions.setDefault')
                  }
                >
                  <Pin
                    className={`h-3.5 w-3.5 ${
                      user?.default_prompt_id === selectedPrompt.id ? 'fill-primary/25' : ''
                    }`}
                  />
                </Button>
              )}
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShareDialogOpen(true)}
                  title={t('components.library.prompts.actions.share')}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {canEditContent && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => enterEditMode(selectedPrompt)}
                  title={t('components.library.prompts.actions.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              {!isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleFork(selectedPrompt)}
                >
                  <Copy className="h-3 w-3" /> {t('components.library.prompts.actions.fork')}
                </Button>
              )}
              {isOwner && (
                <ConfirmButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onConfirm={() => handleDelete(selectedPrompt.id)}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  tooltip={t('components.library.prompts.actions.delete')}
                />
              )}
            </div>
          </div>

          {/* Prompt content */}
          {previewVersion && previewVersion.version !== selectedPrompt.current_version ? (
            <DiffView
              oldText={previewVersion.content}
              newText={selectedPrompt.content}
              oldLabel={`v${previewVersion.version}`}
              newLabel={t('components.library.prompts.labels.currentVersion', {
                version: selectedPrompt.current_version,
              })}
            />
          ) : (
            <PromptViewer content={selectedPrompt.content} variant="panel" />
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/60">
              {t('components.library.prompts.empty.selectPrompt')}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={enterCreateMode}
            >
              <Plus className="mr-1 h-3 w-3" /> {t('components.library.prompts.actions.createNew')}
            </Button>
          </div>
        </div>
      )}
      {selectedPrompt && isOwner && (
        <PromptEditor
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          prompt={selectedPrompt}
          onSaved={() => setShareDialogOpen(false)}
          shareOnly
        />
      )}
    </div>
  )
}
