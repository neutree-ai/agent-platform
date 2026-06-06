import { SkillPreviewDialog } from '@/components/library/SkillPreviewDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { api } from '@/lib/api/client'
import type { ApiCredentialMeta, ApiSkill, ApiSkillSource } from '@/lib/api/types'
import { SKILL_CATEGORY_VALUES, categoryI18nKey } from '@/lib/skill-categories'
import { cn } from '@/lib/utils'
import { AlertTriangle, Check, Eye, FolderOpen, GitBranch, Upload } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SkillMode = 'upload' | 'git'
type SkillTokenSource = 'none' | 'credential' | 'manual'

interface SkillCandidate {
  subpath: string
  name: string | null
  description: string | null
  fileCount: number
  /**
   * Files belonging to this skill. Present when the candidate came from a
   * scan-preview / scan-tarball response; empty when it was reconstructed
   * from a multi-candidate 400 fallback (server only returns subpaths in
   * that case). Use `files.length === 0 && fileCount === 0` to detect.
   */
  files: Array<{ path: string; size: number }>
  /** Raw SKILL.md body. Null when not yet scanned (e.g. 400 fallback). */
  skillMd: string | null
}

export interface SkillFormState {
  mode: SkillMode
  name: string
  description: string
  /**
   * Skill category. Empty string means "leave unset / clear" — that maps
   * to NULL on the server. Non-empty values are one of SKILL_CATEGORY_VALUES.
   */
  category: string
  // Upload mode
  file: File | null
  // Git mode
  gitUrl: string
  /** Branch or tag. Empty → server default (typically "main"). */
  gitRef: string
  gitType: 'github' | 'gitlab'
  gitToken: string
  tokenSource: SkillTokenSource
  selectedCredential: string
  /**
   * Pre-flight scan output. Populated by either the Preview button or the
   * 400 fallback from a multi-candidate submit. `null` means "not scanned
   * yet". An empty array means "scanned, no skills found".
   */
  candidates: SkillCandidate[] | null
  /**
   * Subpaths the user picked from the candidate list. Multi-select for
   * Create mode (monorepo bulk import); Edit mode caps it at one. Empty
   * means "no scan yet" or "user cleared selection".
   */
  subpaths: string[]
}

export const INITIAL_SKILL_FORM: SkillFormState = {
  mode: 'upload',
  name: '',
  description: '',
  category: '',
  file: null,
  gitUrl: '',
  gitRef: '',
  gitType: 'github',
  gitToken: '',
  tokenSource: 'none',
  selectedCredential: '',
  candidates: null,
  subpaths: [],
}

/**
 * `<Select>` requires a non-empty value, so we use a sentinel for the
 * "no category" choice. It's stripped before sending to the API.
 */
const CATEGORY_NONE_VALUE = '__none__'

/**
 * Host-name heuristic mirrored from scs `git-url.ts#detectType`. Returns
 * null for unknown hosts (self-hosted GitHub Enterprise / private GitLab
 * on a custom domain) so the form can keep whatever the user picked
 * manually. Known hosts (github.com / gitlab.com / gitlab.foo.com) are
 * forced to the detected value — for those, the select is effectively
 * read-only because there's only one right answer.
 */
function detectGitType(rawUrl: string): 'github' | 'gitlab' | null {
  const url = rawUrl.trim()
  if (!url) return null
  let host: string
  try {
    host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host.includes('github')) return 'github'
  if (host.includes('gitlab')) return 'gitlab'
  return null
}

interface SkillFormFieldsProps {
  form: SkillFormState
  setForm: (next: (prev: SkillFormState) => SkillFormState) => void
  credentials: ApiCredentialMeta[]
  /** Set when this is the edit flow — locks the name, makes the file
   *  optional ("keep current"), and shows the git last-synced banner. */
  editingSkill?: ApiSkill | null
  /** Resolved source for `editingSkill`. Required when `editingSkill.source_id`
   *  points at a `kind='git'` row so the git fields can be prefilled and the
   *  last-synced banner can render. Pass `null` while still loading. */
  editingSource?: ApiSkillSource | null
  /** Stable id prefix to keep file inputs unique when both create and
   *  edit dialogs are mounted simultaneously. */
  idPrefix: string
}

/**
 * Skill create/edit body fields. Shared between `CreateSkillDialog` and
 * the in-place edit dialog inside `SkillsSection`. Form state is held by
 * the parent so the parent can wire mutations and reset/dismiss flows.
 */
export function SkillFormFields({
  form,
  setForm,
  credentials,
  editingSkill,
  editingSource,
  idPrefix,
}: SkillFormFieldsProps) {
  const { t } = useTranslation()
  const isEditing = !!editingSkill
  // p3: a skill's "origin kind" lives on its source row, not the skill row.
  // While the source is still loading we conservatively assume native
  // (single-mode UI) — it'll re-render with the toggle once the source lands.
  const isGitSource = editingSource?.kind === 'git'
  const isNativeSource = editingSource?.kind === 'native'
  // Editing a native skill: expose the toggle so the user can flip it to a Git
  // source in place (destructive switch — confirmed at submit). We only show it
  // once the source has resolved to 'native' so we don't offer the switch
  // before we know the skill's origin kind. Create + git-edit show it as before.
  const showModeToggle = !isEditing || isGitSource || isNativeSource
  // Flipping a native skill into git mode means "switch source", not a routine
  // re-import — surface the history-loss warning inline before the confirm gate.
  const isNativeSwitch = isEditing && isNativeSource && form.mode === 'git'

  // Scan state is local — it isn't persisted across dialog opens, but the
  // resulting `candidates` + chosen `subpath` go into form state so they
  // survive any re-render (and submit handlers can read them).
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  // Which candidate is currently being previewed in the read-only dialog.
  // Null = closed; otherwise an index into form.candidates.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const previewCandidate =
    previewIndex !== null && form.candidates ? form.candidates[previewIndex] : null

  // Scroll the candidate picker into view after a fresh scan. Without this
  // the picker can land below the dialog fold and users miss that there's
  // new content. Only scrolls on a *new* candidate list — the count change
  // is the trigger, so re-clicking Preview with the same result is silent.
  const candidatePickerRef = useRef<HTMLDivElement | null>(null)
  const candidatesLen = form.candidates?.length ?? -1
  useEffect(() => {
    if (candidatesLen < 0) return
    candidatePickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [candidatesLen])

  // Keep `gitType` synced with the URL host. Known hosts force the select
  // to the matching provider; unknown hosts (private / enterprise) leave
  // whatever the user picked manually intact. This makes "Auto-detect" an
  // implicit behavior of the URL field rather than a third select option.
  useEffect(() => {
    const detected = detectGitType(form.gitUrl)
    if (detected && detected !== form.gitType) {
      setForm((f) => ({ ...f, gitType: detected }))
    }
  }, [form.gitUrl, form.gitType, setForm])

  // Drag-and-drop state for upload mode. We accept the first dropped file
  // matching .tar.gz / .tgz, drop everything else with a quiet error so the
  // dropzone stays unobtrusive (the user can still try again).
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  function isAcceptableTarball(file: File): boolean {
    const n = file.name.toLowerCase()
    return n.endsWith('.tar.gz') || n.endsWith('.tgz') || file.type === 'application/gzip'
  }
  function applyChosenFile(file: File | null) {
    // Selecting a new file invalidates any prior scan output.
    setForm((f) => ({ ...f, file, candidates: null, subpaths: [] }))
    setScanError(null)
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDraggingFile(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!isAcceptableTarball(file)) {
      setScanError(t('components.library.skills.errors.invalidFileType'))
      return
    }
    applyChosenFile(file)
  }

  async function handleScanTarball() {
    if (!form.file) return
    setIsScanning(true)
    setScanError(null)
    try {
      const buf = await form.file.arrayBuffer()
      const { candidates } = await api.scanSkillTarball(buf)
      // Hand-packed tarballs typically have one root skill; we still let
      // the picker render so the user can confirm what's in there.
      setForm((f) => ({
        ...f,
        candidates,
        subpaths: candidates.length === 1 ? [candidates[0].subpath] : [],
      }))
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : t('components.library.skills.errors.scanFailed'),
      )
    } finally {
      setIsScanning(false)
    }
  }
  async function handleScan() {
    if (!form.gitUrl.trim()) {
      setScanError(t('components.library.skills.errors.gitUrlRequired'))
      return
    }
    setIsScanning(true)
    setScanError(null)
    try {
      const { candidates, requested_subpath: requestedSubpath } = await api.scanSkillRepo({
        url: form.gitUrl.trim(),
        type: form.gitType,
        // Mirror the same empty-→-'main' default used at import-time so
        // scan and import target the same content (see CreateSkillDialog).
        ref: form.gitRef.trim() || 'main',
        token: form.tokenSource === 'manual' ? form.gitToken.trim() || undefined : undefined,
        credential_name:
          form.tokenSource === 'credential' ? form.selectedCredential || undefined : undefined,
      })
      // Auto-select when there's nothing to disambiguate: either the input
      // URL pointed at a specific subpath with a matching candidate, or the
      // scan found exactly one candidate. Otherwise reset selection — stale
      // picks from a previous scan no longer apply, and multi-candidate repos
      // require an explicit pick. `null` (not '') means "user must pick", so a
      // single root skill whose subpath is '' still auto-selects.
      const autoSelect =
        requestedSubpath && candidates.some((c) => c.subpath === requestedSubpath)
          ? requestedSubpath
          : candidates.length === 1
            ? candidates[0].subpath
            : null
      setForm((f) => ({ ...f, candidates, subpaths: autoSelect !== null ? [autoSelect] : [] }))
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : t('components.library.skills.errors.scanFailed'),
      )
    } finally {
      setIsScanning(false)
    }
  }
  return (
    <div className="space-y-4">
      <SkillPreviewDialog
        open={previewIndex !== null}
        onOpenChange={(o) => !o && setPreviewIndex(null)}
        candidate={previewCandidate}
        onPick={(subpath) =>
          setForm((f) => ({
            ...f,
            // Picking from the preview dialog: in edit mode we replace
            // (single-pick); in create mode we toggle into the existing
            // multi-select set.
            subpaths: isEditing
              ? [subpath]
              : f.subpaths.includes(subpath)
                ? f.subpaths
                : [...f.subpaths, subpath],
          }))
        }
        isPicked={previewCandidate ? form.subpaths.includes(previewCandidate.subpath) : false}
      />
      {showModeToggle && (
        <SegmentedControl
          value={form.mode}
          onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}
          variant="box"
          size="md"
          className="w-full [&>button]:flex-1"
          options={[
            {
              value: 'upload',
              label: t('components.library.skills.modes.upload'),
              icon: Upload,
            },
            {
              value: 'git',
              label: t('components.library.skills.modes.git'),
              icon: GitBranch,
            },
          ]}
        />
      )}

      {isNativeSwitch && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-tiny text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('components.library.skills.switchHint')}</span>
        </div>
      )}

      {form.mode === 'git' ? (
        <>
          {isGitSource && editingSource && (
            <div className="rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2 text-tiny text-muted-foreground">
              {editingSource.last_synced_at &&
                t('components.library.skills.labels.lastSynced', {
                  value: new Date(editingSource.last_synced_at).toLocaleString(),
                })}
              {editingSource.last_commit_sha && (
                <>
                  {' · '}
                  <code className="rounded bg-foreground/[0.06] px-1 font-mono">
                    {editingSource.last_commit_sha.slice(0, 7)}
                  </code>
                </>
              )}
            </div>
          )}
          <Field
            label={t('components.library.skills.fields.repositoryUrl')}
            help={t('components.library.skills.help.repositoryUrl')}
            htmlFor={`${idPrefix}-git-url`}
          >
            <div className="flex items-center gap-2">
              <Input
                id={`${idPrefix}-git-url`}
                className="h-9 flex-1 text-sm"
                value={form.gitUrl}
                onChange={(e) => {
                  // Clear any prior scan if the URL changes — the candidate
                  // list no longer matches what the user is about to fetch.
                  setForm((f) => ({
                    ...f,
                    gitUrl: e.target.value,
                    candidates: null,
                    subpaths: [],
                  }))
                  setScanError(null)
                }}
                placeholder={t('components.library.skills.placeholders.repositoryUrl')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 text-xs"
                disabled={isScanning || !form.gitUrl.trim()}
                onClick={handleScan}
              >
                {isScanning ? (
                  <Spinner size="sm" className="h-3 w-3" />
                ) : (
                  <FolderOpen className="h-3 w-3" />
                )}
                {t('components.library.skills.actions.previewSkills')}
              </Button>
            </div>
          </Field>
          {/* Separate ref field — keeps URL inputs uniform and parallels the
              EditSourceDialog UX. Server defaults to main when empty. */}
          <Field
            label={t('components.library.skills.fields.gitRef')}
            htmlFor={`${idPrefix}-git-ref`}
          >
            <Input
              id={`${idPrefix}-git-ref`}
              className="h-9 text-sm"
              value={form.gitRef}
              onChange={(e) => {
                setForm((f) => ({
                  ...f,
                  gitRef: e.target.value,
                  // Ref change invalidates the candidate list — different
                  // branch, possibly different subpaths.
                  candidates: null,
                  subpaths: [],
                }))
                setScanError(null)
              }}
              placeholder={t('components.library.skills.placeholders.gitRef')}
            />
          </Field>
          {scanError && <div className="text-xs text-destructive">{scanError}</div>}
          {form.candidates && (
            <div ref={candidatePickerRef}>
              <CandidatePicker
                candidates={form.candidates}
                selected={form.subpaths}
                singleSelect={isEditing}
                onToggle={(subpath) =>
                  setForm((f) => {
                    if (isEditing) return { ...f, subpaths: [subpath] }
                    const has = f.subpaths.includes(subpath)
                    return {
                      ...f,
                      subpaths: has
                        ? f.subpaths.filter((s) => s !== subpath)
                        : [...f.subpaths, subpath],
                    }
                  })
                }
                onSelectAll={(all) => setForm((f) => ({ ...f, subpaths: all }))}
                onPreview={(idx) => setPreviewIndex(idx)}
              />
            </div>
          )}

          <Field
            label={t('components.createSkill.fields.gitType')}
            help={t('components.createSkill.help.gitType')}
            htmlFor={`${idPrefix}-git-type`}
          >
            <Select
              value={form.gitType}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, gitType: v as SkillFormState['gitType'] }))
              }
            >
              <SelectTrigger id={`${idPrefix}-git-type`} className="h-9 text-sm focus:ring-inset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github" className="py-2">
                  {t('components.createSkill.gitTypes.github')}
                </SelectItem>
                <SelectItem value="gitlab" className="py-2">
                  {t('components.createSkill.gitTypes.gitlab')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t('components.library.skills.fields.accessTokenOptional')}
            htmlFor={`${idPrefix}-token-source`}
          >
            <SegmentedControl
              value={form.tokenSource}
              onValueChange={(v) => setForm((f) => ({ ...f, tokenSource: v }))}
              variant="box"
              size="md"
              className="w-full [&>button]:flex-1"
              options={[
                {
                  value: 'none' as const,
                  label: t('components.library.skills.tokenSources.none'),
                },
                {
                  value: 'credential' as const,
                  label: t('components.library.skills.tokenSources.credential'),
                },
                {
                  value: 'manual' as const,
                  label: t('components.library.skills.tokenSources.manual'),
                },
              ]}
            />
            {form.tokenSource === 'credential' && (
              <Select
                value={form.selectedCredential}
                onValueChange={(v) => setForm((f) => ({ ...f, selectedCredential: v }))}
              >
                <SelectTrigger className="mt-2 h-9 text-sm focus:ring-inset">
                  <SelectValue
                    placeholder={t('components.library.skills.placeholders.selectCredential')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {credentials.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t('components.library.skills.empty.noCredentials')}
                    </div>
                  ) : (
                    credentials
                      .filter((c) => c.inject === 'env')
                      .map((c) => (
                        <SelectItem key={c.name} value={c.name} className="py-2">
                          {c.name}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            )}
            {form.tokenSource === 'manual' && (
              <Input
                className="mt-2 h-9 text-sm"
                type="password"
                value={form.gitToken}
                onChange={(e) => setForm((f) => ({ ...f, gitToken: e.target.value }))}
                placeholder={t('components.library.skills.placeholders.privateRepositoryToken')}
              />
            )}
          </Field>

          {/* Per-skill name / description overrides only make sense when
              importing a single subpath. For monorepo multi-select we
              auto-derive from each SKILL.md instead. */}
          {form.subpaths.length > 1 ? (
            <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
              {t('components.library.skills.scan.multiHint', { count: form.subpaths.length })}
            </div>
          ) : (
            <>
              <Field
                label={
                  isEditing
                    ? t('components.library.skills.fields.name')
                    : t('components.library.skills.fields.nameOptional')
                }
                htmlFor={`${idPrefix}-git-name`}
              >
                <Input
                  id={`${idPrefix}-git-name`}
                  className="h-9 text-sm"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('components.library.skills.placeholders.autoDetectedName')}
                  disabled={isEditing}
                />
              </Field>
              <Field
                label={t('components.library.skills.fields.descriptionOptional')}
                htmlFor={`${idPrefix}-git-desc`}
              >
                <Textarea
                  id={`${idPrefix}-git-desc`}
                  className="min-h-[64px] resize-none text-sm"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={t('components.library.skills.placeholders.autoDetectedDescription')}
                />
              </Field>
              <CategoryField
                id={`${idPrefix}-git-category`}
                value={form.category}
                onChange={(c) => setForm((f) => ({ ...f, category: c }))}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Field label={t('components.library.skills.fields.name')} htmlFor={`${idPrefix}-name`}>
            <Input
              id={`${idPrefix}-name`}
              className="h-9 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('components.library.skills.placeholders.name')}
              disabled={isEditing}
            />
          </Field>
          <Field
            label={t('components.library.skills.fields.description')}
            htmlFor={`${idPrefix}-desc`}
          >
            <Textarea
              id={`${idPrefix}-desc`}
              className="min-h-[64px] resize-none text-sm"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('components.library.skills.placeholders.description')}
            />
          </Field>
          <CategoryField
            id={`${idPrefix}-category`}
            value={form.category}
            onChange={(c) => setForm((f) => ({ ...f, category: c }))}
          />
          <Field
            label={
              isEditing
                ? t('components.library.skills.fields.packageKeepCurrent')
                : t('components.library.skills.fields.package')
            }
          >
            {/*
             * Dropzone wraps the click-to-pick controls so the whole row
             * accepts a dragged .tar.gz file. Dashed-border highlight is
             * only visible while a file is actively being dragged over —
             * empty-state copy gets a subtle hint underneath.
             */}
            <div
              role="presentation"
              onDragEnter={(e) => {
                e.preventDefault()
                setIsDraggingFile(true)
              }}
              onDragOver={(e) => {
                // preventDefault on dragover is what enables the drop event.
                e.preventDefault()
                if (!isDraggingFile) setIsDraggingFile(true)
              }}
              onDragLeave={(e) => {
                // Only flip the state off when the pointer truly leaves the
                // dropzone — child enter/leave events fire continuously.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setIsDraggingFile(false)
              }}
              onDrop={handleDrop}
              className={cn(
                // Always show a dashed outline when empty so the row reads as
                // a drop target at rest. Once a file is picked the row stops
                // looking like a dropzone — drop is still allowed (replaces
                // the file) but the affordance recedes.
                'relative rounded-md border-2 border-dashed transition-colors',
                'flex items-center gap-2 px-3 py-2',
                !form.file && 'border-foreground/15',
                form.file && 'border-transparent px-0 py-0',
                // Dragging-over state is intentionally loud: primary border
                // + tinted background + a centered "Drop here" overlay that
                // dims the controls underneath.
                isDraggingFile && 'border-primary bg-primary/[0.08]',
              )}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => document.getElementById(`${idPrefix}-file`)?.click()}
              >
                <Upload className="h-3 w-3" />
                {form.file ? form.file.name : t('components.library.skills.actions.chooseFile')}
              </Button>
              {!form.file && (
                <span className="text-tiny text-muted-foreground">
                  {t('components.library.skills.help.dropHint')}
                </span>
              )}
              {form.file && (
                <>
                  <span className="text-tiny text-muted-foreground">
                    {(form.file.size / 1024).toFixed(1)} KB
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 text-xs"
                    disabled={isScanning}
                    onClick={handleScanTarball}
                  >
                    {isScanning ? (
                      <Spinner size="sm" className="h-3 w-3" />
                    ) : (
                      <FolderOpen className="h-3 w-3" />
                    )}
                    {t('components.library.skills.actions.previewSkills')}
                  </Button>
                </>
              )}
              {isDraggingFile && (
                // Overlay sits on top of the controls so the user gets a
                // confident "yes, release here" cue. `pointer-events-none`
                // lets drag events still reach the underlying row.
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-md bg-background/85 text-xs font-medium text-primary">
                  <Upload className="h-4 w-4" />
                  {t('components.library.skills.help.dropActive')}
                </div>
              )}
              <input
                id={`${idPrefix}-file`}
                type="file"
                accept=".tar.gz,.tgz,application/gzip"
                className="hidden"
                onChange={(e) => applyChosenFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
          {scanError && form.mode === 'upload' && (
            <div className="text-xs text-destructive">{scanError}</div>
          )}
          {form.candidates && form.mode === 'upload' && (
            <div ref={candidatePickerRef}>
              {/* Upload mode is single-skill (one tarball → one skill);
                  the picker is read-only preview here, no bulk pick. */}
              <CandidatePicker
                candidates={form.candidates}
                selected={form.subpaths}
                singleSelect
                onToggle={(subpath) => setForm((f) => ({ ...f, subpaths: [subpath] }))}
                onPreview={(idx) => setPreviewIndex(idx)}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Inline list rendered below the URL input when a scan returns candidates
 * or when the from-git submit returned multiple. Multi-select for Create
 * mode (monorepo bulk import) and single-select for Edit / Upload modes.
 * Picking rows stamps subpaths into form state — the user still has to
 * click Save to actually import.
 */
function CandidatePicker({
  candidates,
  selected,
  singleSelect = false,
  onToggle,
  onSelectAll,
  onPreview,
}: {
  candidates: SkillCandidate[]
  selected: string[]
  singleSelect?: boolean
  onToggle: (subpath: string) => void
  /** Bulk set — used by "Select all" / "Clear" affordances. Optional;
   *  single-select callers can omit it. */
  onSelectAll?: (subpaths: string[]) => void
  /** Open the read-only preview dialog for `candidates[index]`. */
  onPreview: (index: number) => void
}) {
  const { t } = useTranslation()
  if (candidates.length === 0) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
        {t('components.library.skills.scan.empty')}
      </div>
    )
  }
  const selectedSet = new Set(selected)
  const allPicked = candidates.every((c) => selectedSet.has(c.subpath))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {selected.length > 0 && !singleSelect
            ? t('components.library.skills.scan.foundCountSelected', {
                count: candidates.length,
                selected: selected.length,
              })
            : t('components.library.skills.scan.foundCount', { count: candidates.length })}
        </span>
        <div className="flex items-center gap-2">
          {!singleSelect && candidates.length > 1 && onSelectAll && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onSelectAll(allPicked ? [] : candidates.map((c) => c.subpath))}
            >
              {allPicked
                ? t('components.library.skills.scan.clearAll')
                : t('components.library.skills.scan.selectAll')}
            </button>
          )}
          {singleSelect && selected.length > 0 && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onToggle(selected[0])}
            >
              {t('components.library.skills.scan.clearPick')}
            </button>
          )}
        </div>
      </div>
      {/*
       * No inner scroll — the parent dialog already owns vertical scroll,
       * and nesting two scroll regions makes the picker feel claustrophobic
       * (especially with the mouse wheel switching containers as it crosses
       * the boundary). The list grows; the dialog scrolls.
       */}
      <div className="rounded-md border border-foreground/[0.08]">
        {candidates.map((c, idx) => {
          const isSelected = selectedSet.has(c.subpath)
          // Detail data (files + skillMd) is only present when this candidate
          // came from a scan-preview / scan-tarball call. Multi-candidate 400
          // fallback rows only carry the subpath, so the Eye button has
          // nothing to show — hide it for those.
          const hasDetail = c.skillMd !== null || c.files.length > 0
          return (
            // Use a div instead of a button so the nested Preview button is a
            // legal child; click on the row body triggers `onPick`.
            <div
              key={c.subpath}
              className={cn(
                'flex w-full items-start gap-2 border-b border-foreground/[0.06] px-3 py-2 text-xs last:border-b-0 transition-colors',
                isSelected ? 'bg-primary/10' : 'hover:bg-foreground/[0.03]',
              )}
            >
              <button
                type="button"
                onClick={() => onToggle(c.subpath)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {/* Checkbox shape for multi-select, circle for single-select.
                      Visual hint that "pick one vs pick many" is on the table. */}
                  {singleSelect ? (
                    isSelected ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <span className="h-3 w-3 rounded-full border border-foreground/20" />
                    )
                  ) : isSelected ? (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-sm border border-foreground/30" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5 overflow-hidden">
                  {/* subpath + name on one line — both need their own `min-w-0`
                      so a long name doesn't fight a long subpath for room. */}
                  <div className="flex min-w-0 items-baseline gap-2">
                    <code className="min-w-0 truncate font-mono text-[11px] text-foreground">
                      {c.subpath || '/'}
                    </code>
                    {c.name && (
                      <span className="min-w-0 truncate text-foreground/80">{c.name}</span>
                    )}
                  </div>
                  {c.description && (
                    // line-clamp instead of truncate so long descriptions show
                    // two lines + ellipsis (truncate would clip mid-sentence
                    // when there's vertical room).
                    <div className="line-clamp-2 break-words text-muted-foreground">
                      {c.description}
                    </div>
                  )}
                  {hasDetail && (
                    <div className="text-muted-foreground">
                      {t('components.library.skills.scan.fileCount', { count: c.fileCount })}
                    </div>
                  )}
                </div>
              </button>
              {hasDetail && (
                <button
                  type="button"
                  onClick={() => onPreview(idx)}
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  title={t('components.library.skills.preview.title')}
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Category Select with a "None" option. Empty form.category value renders
 * as the None choice; selecting None sets the form value back to empty
 * so callers can detect "user wants to clear" downstream (PATCH with
 * `category: null`).
 */
function CategoryField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Field
      label={t('components.library.skills.fields.category')}
      help={t('components.library.skills.help.category')}
      htmlFor={id}
    >
      <Select
        value={value === '' ? CATEGORY_NONE_VALUE : value}
        onValueChange={(v) => onChange(v === CATEGORY_NONE_VALUE ? '' : v)}
      >
        <SelectTrigger id={id} className="h-9 text-sm focus:ring-inset">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CATEGORY_NONE_VALUE} className="py-2 text-muted-foreground">
            {t('components.library.skills.categories.uncategorized')}
          </SelectItem>
          {SKILL_CATEGORY_VALUES.map((v) => (
            <SelectItem key={v} value={v} className="py-2">
              {t(categoryI18nKey(v))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string
  help?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {help && <p className="text-tiny text-muted-foreground">{help}</p>}
    </div>
  )
}
