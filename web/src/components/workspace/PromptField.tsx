import { PromptEditor } from '@/components/PromptEditor'
import { PromptViewer } from '@/components/prompt/PromptViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { myPromptsQueryKey, promptsQueryKey, usePrompts } from '@/hooks/usePrompts'
import type { ApiPrompt, PromptVisibility } from '@/lib/api/types'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronsUpDown,
  CircleSlash,
  Globe,
  LayoutTemplate,
  Library,
  Lock,
  Pencil,
  PencilLine,
  Plus,
  Unlink,
  Users,
} from 'lucide-react'

const VISIBILITY_ICON: Record<PromptVisibility, typeof Lock> = {
  private: Lock,
  team: Users,
  public: Globe,
}
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldHint } from './agent-config/FieldHint'

/**
 * A named, ready-made starting point for the custom editor. Picking a
 * preset is not a library reference — it drops `content` into custom
 * mode so the user can edit from there. The `id` is only used as a
 * stable list key; it is never persisted on the field's value.
 */
interface PromptPreset {
  id: string
  name: string
  content: string
}

interface PromptFieldProps {
  /** Selected library prompt id, null = custom / none */
  promptId: string | null
  /** Current text content (editable in custom mode, shown as preview in library mode) */
  content: string
  onChange: (patch: { promptId?: string | null; content?: string }) => void

  label?: string
  placeholder?: string
  /** Allow "None" option (no prompt selected at all). Default false */
  allowNone?: boolean
  /** Allow "Custom" free-text option. Default true */
  allowCustom?: boolean
  /**
   * Custom-mode starting points. Picking one switches to custom mode
   * with its content prefilled. Requires custom mode to be allowed.
   */
  presets?: PromptPreset[]
  /** Heading for the presets group. Default: localized "Presets". */
  presetsLabel?: string
  /**
   * Allow creating a new library prompt inline from the picker. The
   * freshly created prompt is selected automatically. Default true.
   */
  allowCreate?: boolean
  /** Show "Edit in Library" / "Detach & Edit" buttons. Default false */
  showLibraryActions?: boolean
  /** Preview area max height. Default "300px" */
  previewMaxHeight?: string
  /** Custom textarea min rows. Default 4 */
  textareaRows?: number

  /** Template prompt id for FieldHint diff (agent config only) */
  templatePromptId?: string | null
  onRevert?: () => void
}

function excerpt(content: string, max = 120): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  // Use first non-empty line; collapse internal whitespace
  const firstLine = trimmed.split('\n').find((l) => l.trim().length > 0) ?? trimmed
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

export function PromptField({
  promptId,
  content,
  onChange,
  label = 'Prompt',
  placeholder = 'Prompt content...',
  allowNone = false,
  allowCustom = true,
  presets,
  presetsLabel,
  allowCreate = true,
  showLibraryActions = false,
  previewMaxHeight = '300px',
  textareaRows = 4,
  templatePromptId,
  onRevert,
}: PromptFieldProps) {
  const { t } = useTranslation()
  const { prompts: allPrompts, isLoading } = usePrompts()
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const promptById = useMemo(() => {
    const m = new Map<string, ApiPrompt>()
    for (const p of allPrompts) m.set(p.id, p)
    return m
  }, [allPrompts])

  const yours = useMemo(
    () =>
      allPrompts
        .filter((p) => p.is_own)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPrompts],
  )
  const shared = useMemo(
    () =>
      allPrompts
        .filter((p) => !p.is_own && p.shared_via_teams.length > 0)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPrompts],
  )
  const publics = useMemo(
    () =>
      allPrompts
        .filter((p) => !p.is_own && p.shared_via_teams.length === 0 && p.visibility === 'public')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPrompts],
  )

  const isLibrary = promptId !== null
  const editingPrompt: ApiPrompt | null = isLibrary ? (promptById.get(promptId) ?? null) : null

  const displayContent = isLibrary ? (editingPrompt?.content ?? content) : content

  // Determine current mode for trigger label
  let mode: 'library' | 'custom' | 'none'
  if (isLibrary) {
    mode = 'library'
  } else if (allowNone && !allowCustom) {
    mode = 'none'
  } else if (allowNone && allowCustom && !content && promptId === null) {
    mode = 'none'
  } else {
    mode = 'custom'
  }

  function selectNone() {
    onChange({ promptId: null, content: '' })
    setPickerOpen(false)
  }

  function selectCustom() {
    onChange({ promptId: null })
    setPickerOpen(false)
  }

  function selectPreset(preset: PromptPreset) {
    onChange({ promptId: null, content: preset.content })
    setPickerOpen(false)
  }

  function openCreate() {
    setPickerOpen(false)
    setCreateOpen(true)
  }

  // After inline creation, select the new prompt right away. Insert it into
  // the cache optimistically so the trigger label resolves before the
  // background refetch lands; the invalidate then reconciles with the server.
  function handleCreated(created?: ApiPrompt) {
    if (!created) return
    queryClient.setQueryData<ApiPrompt[]>(myPromptsQueryKey, (old) =>
      old ? [created, ...old] : [created],
    )
    queryClient.invalidateQueries({ queryKey: promptsQueryKey })
    onChange({ promptId: created.id, content: created.content })
  }

  function selectLibrary(id: string) {
    const p = promptById.get(id)
    if (p) onChange({ promptId: id, content: p.content })
    setPickerOpen(false)
  }

  function renderItem(prompt: ApiPrompt) {
    const isSel = promptId === prompt.id
    const VisIcon = VISIBILITY_ICON[prompt.visibility]
    const teamLabel = prompt.shared_via_teams.map((tm) => tm.name).join(', ')
    return (
      <CommandItem
        key={prompt.id}
        value={prompt.id}
        keywords={[prompt.name, excerpt(prompt.content, 200), teamLabel]}
        onSelect={() => selectLibrary(prompt.id)}
        className="items-start gap-2 py-1.5"
      >
        <div className="flex h-4 w-4 shrink-0 items-center justify-center mt-0.5">
          {isSel ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <VisIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <span className="truncate">{prompt.name}</span>
            {!prompt.is_own && prompt.owner_name && (
              <span className="text-mini font-normal text-muted-foreground/60 truncate">
                @{prompt.owner_name}
              </span>
            )}
            {!prompt.is_own && teamLabel && (
              <span className="text-mini font-normal text-muted-foreground/60 truncate">
                · {teamLabel}
              </span>
            )}
          </div>
          {excerpt(prompt.content) && (
            <div className="text-tiny text-muted-foreground/70 line-clamp-2">
              {excerpt(prompt.content)}
            </div>
          )}
        </div>
      </CommandItem>
    )
  }

  // Trigger label
  const triggerLabel = (() => {
    if (mode === 'library') {
      const name = editingPrompt?.name ?? t('components.promptField.empty.unknownPrompt')
      const VisIcon = editingPrompt ? VISIBILITY_ICON[editingPrompt.visibility] : Library
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <VisIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate">{name}</span>
          {editingPrompt && !editingPrompt.is_own && editingPrompt.owner_name && (
            <span className="text-mini text-muted-foreground/60 truncate">
              @{editingPrompt.owner_name}
            </span>
          )}
        </span>
      )
    }
    if (mode === 'custom') {
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <PencilLine className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate">{t('components.promptField.options.custom')}</span>
        </span>
      )
    }
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <CircleSlash className="h-3 w-3 shrink-0" />
        <span className="truncate">{t('components.promptField.options.none')}</span>
      </span>
    )
  })()

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen} modal>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-between gap-2 text-xs font-normal"
            >
              {triggerLabel}
              <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            collisionPadding={16}
            className="w-[--radix-popover-trigger-width] min-w-[360px] p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : (
              <Command>
                <CommandInput
                  placeholder={t('components.promptField.placeholders.search')}
                  className="h-9 text-xs"
                />
                <CommandList className="max-h-[min(60vh,360px)] overflow-y-auto">
                  <CommandEmpty className="py-6 text-xs text-muted-foreground/60">
                    {t('components.promptField.empty.noResults')}
                  </CommandEmpty>
                  {(allowNone || allowCustom || allowCreate) && (
                    <CommandGroup heading={t('components.promptField.groups.quick')}>
                      {allowNone && (
                        <CommandItem
                          value="__opt_none__"
                          keywords={[t('components.promptField.options.none')]}
                          onSelect={selectNone}
                          className="items-start gap-2 py-1.5"
                        >
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            {mode === 'none' ? (
                              <Check className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <CircleSlash className="h-3.5 w-3.5 text-muted-foreground/60" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium">
                              {t('components.promptField.options.none')}
                            </div>
                            <div className="text-tiny text-muted-foreground/70">
                              {t('components.promptField.options.noneDesc')}
                            </div>
                          </div>
                        </CommandItem>
                      )}
                      {allowCustom && (
                        <CommandItem
                          value="__opt_custom__"
                          keywords={[t('components.promptField.options.custom')]}
                          onSelect={selectCustom}
                          className="items-start gap-2 py-1.5"
                        >
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            {mode === 'custom' ? (
                              <Check className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <PencilLine className="h-3.5 w-3.5 text-muted-foreground/60" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium">
                              {t('components.promptField.options.custom')}
                            </div>
                            <div className="text-tiny text-muted-foreground/70">
                              {t('components.promptField.options.customDesc')}
                            </div>
                          </div>
                        </CommandItem>
                      )}
                      {allowCreate && (
                        <CommandItem
                          value="__opt_new__"
                          keywords={[t('components.promptField.options.new')]}
                          onSelect={openCreate}
                          className="items-start gap-2 py-1.5"
                        >
                          <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            <Plus className="h-3.5 w-3.5 text-primary/70" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium">
                              {t('components.promptField.options.new')}
                            </div>
                            <div className="text-tiny text-muted-foreground/70">
                              {t('components.promptField.options.newDesc')}
                            </div>
                          </div>
                        </CommandItem>
                      )}
                    </CommandGroup>
                  )}
                  {presets && presets.length > 0 && (
                    <CommandGroup
                      heading={presetsLabel ?? t('components.promptField.groups.presets')}
                    >
                      {presets.map((preset) => (
                        <CommandItem
                          key={preset.id}
                          value={`__preset__${preset.id}`}
                          keywords={[preset.name]}
                          onSelect={() => selectPreset(preset)}
                          className="items-center gap-2 py-1.5"
                        >
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                            <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground/60" />
                          </div>
                          <span className="truncate text-xs font-medium">{preset.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {yours.length > 0 && (
                    <CommandGroup heading={t('components.promptField.groups.yours')}>
                      {yours.map(renderItem)}
                    </CommandGroup>
                  )}
                  {shared.length > 0 && (
                    <CommandGroup heading={t('components.promptField.groups.shared')}>
                      {shared.map(renderItem)}
                    </CommandGroup>
                  )}
                  {publics.length > 0 && (
                    <CommandGroup heading={t('components.promptField.groups.public')}>
                      {publics.map(renderItem)}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            )}
          </PopoverContent>
        </Popover>

        {templatePromptId !== undefined && onRevert && (
          <FieldHint current={promptId} template={templatePromptId} onRevert={onRevert} />
        )}
      </div>

      {mode === 'library' ? (
        <>
          {editingPrompt && !editingPrompt.is_own && (
            <Badge
              variant="outline"
              className="h-5 gap-1 px-1.5 text-mini border-info/30 bg-info/10 text-info"
            >
              {(() => {
                const VisIcon = VISIBILITY_ICON[editingPrompt.visibility]
                return <VisIcon className="h-3 w-3" />
              })()}
              {editingPrompt.visibility === 'team' && editingPrompt.shared_via_teams.length > 0
                ? editingPrompt.shared_via_teams.map((tm) => tm.name).join(', ')
                : t(`components.promptEditor.visibility.${editingPrompt.visibility}`)}
            </Badge>
          )}
          <PromptViewer
            content={displayContent}
            variant="inline"
            maxHeight={previewMaxHeight}
            emptyText={t('components.promptField.empty.noContent')}
          />

          {showLibraryActions && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-1 gap-1.5"
                onClick={() => setEditorOpen(true)}
                disabled={!editingPrompt || !editingPrompt.is_own}
              >
                <Pencil className="h-3 w-3" />
                {t('components.promptField.actions.editInLibrary')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-1 gap-1.5"
                onClick={() => onChange({ promptId: null })}
              >
                <Unlink className="h-3 w-3" />
                {t('components.promptField.actions.detachAndEdit')}
              </Button>
            </div>
          )}
          {showLibraryActions && editingPrompt && editingPrompt.is_own && (
            <PromptEditor
              open={editorOpen}
              onOpenChange={setEditorOpen}
              prompt={editingPrompt}
              onSaved={() => {
                queryClient.invalidateQueries({ queryKey: promptsQueryKey })
                const updated = promptById.get(editingPrompt.id)
                if (updated) {
                  onChange({ content: updated.content })
                }
              }}
            />
          )}
        </>
      ) : mode === 'custom' ? (
        <Textarea
          className="font-mono text-xs focus-visible:ring-inset"
          style={{ minHeight: `${textareaRows * 1.5 + 1}rem` }}
          value={content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder={placeholder}
        />
      ) : null}

      {allowCreate && (
        <PromptEditor
          open={createOpen}
          onOpenChange={setCreateOpen}
          prompt={null}
          onSaved={handleCreated}
        />
      )}
    </div>
  )
}
