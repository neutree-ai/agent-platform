import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { Input } from '@/components/ui/input'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { getTagsDoc } from '@/docs/inline-help/misc-docs'
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/hooks/useTags'
import type { Tag } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { TAG_COLORS, getTagColor } from '@/lib/tag-colors'
import { cn } from '@/lib/utils'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const DEFAULT_COLOR = TAG_COLORS[0].key

/**
 * Tags — global app for managing the workspace tag taxonomy. Tags are
 * user-private (no scope/owned dimensions) and intentionally rendered as a
 * dense list rather than a ResourceGrid: tags are tiny entities (one
 * name + one color) and look lost inside the standard 8.5rem card.
 */
export function TagsSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const { data: tags, isLoading } = useTags()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState(DEFAULT_COLOR)

  useEffect(() => {
    if (!dialogOpen) return
    if (editingTag) {
      setFormName(editingTag.name)
      setFormColor(editingTag.color || DEFAULT_COLOR)
    } else {
      setFormName('')
      setFormColor(DEFAULT_COLOR)
    }
  }, [dialogOpen, editingTag])

  function openCreate() {
    setEditingTag(null)
    setDialogOpen(true)
  }

  function openEdit(tag: Tag) {
    setEditingTag(tag)
    setDialogOpen(true)
  }

  async function handleSave() {
    const name = formName.trim()
    if (!name) return
    try {
      if (editingTag) {
        await updateTag.mutateAsync({ id: editingTag.id, name, color: formColor })
        toast.success(t('components.tagsManage.toasts.updated'))
      } else {
        await createTag.mutateAsync({ name, color: formColor })
        toast.success(t('components.tagsManage.toasts.created'))
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('components.tagsManage.toasts.saveFailed'))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTag.mutateAsync(id)
      toast.success(t('components.tagsManage.toasts.deleted'))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.tagsManage.toasts.deleteFailed'),
      )
    }
  }

  const saving = createTag.isPending || updateTag.isPending
  const deletingId = deleteTag.isPending ? (deleteTag.variables ?? null) : null

  return (
    <>
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.tagsManage.actions.new')}
            onClick={openCreate}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : !tags || tags.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-1">
            {tags.map((tag) => {
              const color = getTagColor(tag.color)
              const isDeleting = deletingId === tag.id
              return (
                <div
                  key={tag.id}
                  className="group/row flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/[0.04]"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', color.bg)} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
                  <span className={cn('shrink-0 text-xs', color.text)}>{color.label}</span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(tag)}
                      aria-label={t('components.tagsManage.actions.edit')}
                      title={t('components.tagsManage.actions.edit')}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {isDeleting ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
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
                        onConfirm={() => handleDelete(tag.id)}
                        icon={<Trash2 className="h-3 w-3" />}
                        tooltip={t('components.tagsManage.actions.delete')}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <DocumentedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editingTag
            ? t('components.tagsManage.dialog.editTitle')
            : t('components.tagsManage.dialog.newTitle')
        }
        docs={getTagsDoc()}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={saving}
              onClick={handleSave}
              label={editingTag ? t('common.update') : t('common.create')}
              disabled={!formName.trim()}
            />
          </>
        }
      >
        <div className="space-y-4">
          <Input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('components.tagsManage.dialog.namePlaceholder')}
            onKeyDown={(e) => {
              if (isCommitEnter(e) && formName.trim()) handleSave()
            }}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            {TAG_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setFormColor(c.key)}
                title={c.label}
                aria-label={c.label}
                aria-pressed={formColor === c.key}
                className={cn(
                  'h-7 w-7 rounded-full transition-all',
                  c.bg,
                  formColor === c.key
                    ? 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-background'
                    : 'opacity-60 hover:opacity-100',
                )}
              />
            ))}
          </div>
        </div>
      </DocumentedDialog>
    </>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      title={t('components.tagsManage.empty.title')}
      description={t('components.tagsManage.empty.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.tagsManage.actions.new')}
        </Button>
      }
    />
  )
}
