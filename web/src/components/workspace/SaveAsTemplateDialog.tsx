import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import type { Workspace } from '@/lib/api/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface SaveAsTemplateDialogProps {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function SaveAsTemplateDialog({
  workspace,
  open,
  onOpenChange,
  onSaved,
}: SaveAsTemplateDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [bind, setBind] = useState(true)
  const [includeCommands, setIncludeCommands] = useState(true)
  const [includeSchedules, setIncludeSchedules] = useState(true)
  const [includeLayout, setIncludeLayout] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(workspace.name)
      setDesc('')
      setBind(true)
      setIncludeCommands(true)
      setIncludeSchedules(true)
      setIncludeLayout(true)
    }
  }, [open, workspace.name])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.saveAsTemplate.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder={t('components.saveAsTemplate.placeholders.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm"
          />
          <Textarea
            placeholder={t('components.saveAsTemplate.placeholders.description')}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="min-h-[60px] text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={bind} onCheckedChange={(v) => setBind(v === true)} />
            {t('components.saveAsTemplate.fields.bind')}
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={includeCommands}
              onCheckedChange={(v) => setIncludeCommands(v === true)}
            />
            {t('components.saveAsTemplate.fields.includeCommands')}
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={includeSchedules}
              onCheckedChange={(v) => setIncludeSchedules(v === true)}
            />
            {t('components.saveAsTemplate.fields.includeSchedules')}
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={includeLayout}
              onCheckedChange={(v) => setIncludeLayout(v === true)}
            />
            {t('components.saveAsTemplate.fields.includeLayout')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true)
              try {
                await api.saveAsTemplate(workspace.id, {
                  name: name.trim(),
                  description: desc.trim() || undefined,
                  bind,
                  include_commands: includeCommands,
                  include_schedules: includeSchedules,
                  include_layout: includeLayout,
                })
                toast.success(t('components.saveAsTemplate.toasts.created'))
                onOpenChange(false)
                if (bind) onSaved?.()
              } catch (e: any) {
                toast.error(e.message || t('components.saveAsTemplate.errors.createFailed'))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <Spinner size="sm" className="mr-1" /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
