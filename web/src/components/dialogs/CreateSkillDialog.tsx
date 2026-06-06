import {
  INITIAL_SKILL_FORM,
  SkillFormFields,
  type SkillFormState,
} from '@/components/dialogs/SkillFormFields'
import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { SaveButton } from '@/components/ui/save-button'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { getSkillDoc, getSkillDocsHint } from '@/docs/inline-help/skill-docs'
import { useImportSkillFromGit, useUpdateSkillMeta, useUploadSkill } from '@/hooks/useSkills'
import { ApiClientError, api } from '@/lib/api/client'
import type { ApiCredentialMeta } from '@/lib/api/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function CreateSkillDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<SkillFormState>(INITIAL_SKILL_FORM)
  const [credentials, setCredentials] = useState<ApiCredentialMeta[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const importFromGit = useImportSkillFromGit()
  const uploadSkill = useUploadSkill()
  const updateMeta = useUpdateSkillMeta()

  useEffect(() => {
    if (open) {
      setForm(INITIAL_SKILL_FORM)
      setError(null)
      api
        .listCredentials()
        .then(setCredentials)
        .catch(() => {})
    }
  }, [open])

  function handleClose() {
    onOpenChange(false)
  }

  async function handleSave() {
    if (form.mode === 'git') {
      if (!form.gitUrl.trim()) {
        setError(t('components.createSkill.errors.gitUrlRequired'))
        return
      }
      // `subpath` is the authoritative selector server-side (required string),
      // and the only way to populate it is to Preview/Scan and pick a
      // candidate (single ones auto-select). Block import until that's done so
      // we never send an empty selector — defends the disabled Create button.
      if (form.subpaths.length === 0) {
        setError(t('components.createSkill.errors.previewRequired'))
        return
      }
      setIsSaving(true)
      setError(null)
      // New skills default to private; owner sets visibility/grants via the
      // Share dialog after creation.
      const commonBody = {
        url: form.gitUrl.trim(),
        type: form.gitType,
        // Empty input → 'main'. Server-side null causes skill_sources.git_ref
        // to be NULL even though the actual tarball is fetched against the
        // repo's default branch (HEAD). Storing 'main' matches the common
        // case; users on master/develop must type the ref explicitly.
        ref: form.gitRef.trim() || 'main',
        token: form.tokenSource === 'manual' ? form.gitToken.trim() || undefined : undefined,
        credential_name:
          form.tokenSource === 'credential' ? form.selectedCredential || undefined : undefined,
        visibility: 'private' as const,
      }
      // Multi-select monorepo import: loop through each picked subpath.
      // Per-skill name/description fall back to whatever SKILL.md declares
      // (overrides only make sense for single import — UI hides those
      // fields when subpaths.length > 1).
      const isBulk = form.subpaths.length > 1
      const targets = form.subpaths
      try {
        const imported: { id: string; subpath: string }[] = []
        const failures: { subpath: string; message: string }[] = []
        for (const subpath of targets) {
          try {
            const res = await importFromGit.mutateAsync({
              ...commonBody,
              name: isBulk ? undefined : form.name.trim() || undefined,
              description: isBulk ? undefined : form.description.trim() || undefined,
              subpath,
            })
            imported.push({ id: res.id, subpath })
            // Category PATCH only meaningful for single import — bulk uses
            // SKILL.md frontmatter category as authored.
            if (!isBulk && form.category) {
              await updateMeta.mutateAsync({ id: res.id, meta: { category: form.category } })
            }
          } catch (err) {
            // Bulk continues past a single failure; single-import re-throws
            // so the catch below can run its 400-candidate fallback.
            if (!isBulk) throw err
            failures.push({
              subpath,
              message: err instanceof Error ? err.message : String(err),
            })
          }
        }
        if (failures.length > 0) {
          const summary = failures.map((f) => `${f.subpath || '/'}: ${f.message}`).join('\n')
          setError(
            t('components.createSkill.errors.bulkPartial', {
              ok: imported.length,
              fail: failures.length,
              details: summary,
            }),
          )
          // Don't close — let the user retry on remaining ones.
          return
        }
        handleClose()
        toast.success(
          isBulk
            ? t('components.createSkill.toasts.importedBulk', { count: imported.length })
            : t('components.createSkill.toasts.importedFromGit'),
        )
      } catch (err) {
        if (
          err instanceof ApiClientError &&
          err.status === 400 &&
          Array.isArray(err.body.candidates)
        ) {
          const subpaths = err.body.candidates as string[]
          setForm((f) => ({
            ...f,
            candidates: subpaths.map((subpath) => ({
              subpath,
              name: null,
              description: null,
              fileCount: 0,
              files: [],
              skillMd: null,
            })),
            subpaths: [],
          }))
          setError(t('components.library.skills.errors.multipleCandidatesPickOne'))
        } else {
          const msg =
            err instanceof Error ? err.message : t('components.createSkill.errors.importFailed')
          setError(msg)
          toast.error(msg)
        }
      } finally {
        setIsSaving(false)
      }
      return
    }

    // Upload mode
    if (!form.name.trim()) {
      setError(t('components.createSkill.errors.nameRequired'))
      return
    }
    if (!form.file) {
      setError(t('components.createSkill.errors.packageRequired'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const buf = await form.file.arrayBuffer()
      const created = await uploadSkill.mutateAsync({
        name: form.name.trim(),
        description: form.description,
        buffer: buf,
        visibility: 'private',
      })
      if (form.category) {
        await updateMeta.mutateAsync({
          id: created.id,
          meta: { category: form.category },
        })
      }
      handleClose()
      toast.success(t('components.createSkill.toasts.uploaded'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('components.createSkill.errors.uploadFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.createSkill.title')}
      docs={getSkillDoc(form.mode)}
      docsHint={getSkillDocsHint()}
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={isSaving}
            onClick={handleSave}
            label={t('common.create')}
            // Git import requires a previewed + picked subpath (the server's
            // required selector). Nudges users to Preview first instead of
            // hitting a cryptic validation error. Upload mode is unaffected.
            disabled={form.mode === 'git' && form.subpaths.length === 0}
          />
        </>
      }
    >
      <SkillFormFields
        form={form}
        setForm={setForm}
        credentials={credentials}
        idPrefix="create-skill"
      />
      {error && <div className="mt-3 text-xs text-destructive">{error}</div>}
    </DocumentedDialog>
  )
}
