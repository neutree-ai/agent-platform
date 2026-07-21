import { SkillExportDialog } from '@/components/dialogs/SkillExportDialog'
import {
  INITIAL_SKILL_FORM,
  SkillFormFields,
  type SkillFormState,
} from '@/components/dialogs/SkillFormFields'
import { SkillShareDialog } from '@/components/dialogs/SkillShareDialog'
import { SkillDeleteDialog } from '@/components/library/SkillDeleteDialog'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { ResourceList } from '@/components/resource/ResourceList'
import { ResourceListItem } from '@/components/resource/ResourceListItem'
import { type ResourceView, ResourceViewToggle } from '@/components/resource/ResourceViewToggle'
import { ScopeBadge } from '@/components/resource/ScopeBadge'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { AppHeaderSearch } from '@/components/shell/windows/AppHeaderSearch'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmMenuItem } from '@/components/ui/confirm-menu-item'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { getSkillDoc, getSkillDocsHint } from '@/docs/inline-help/skill-docs'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useDeleteSkill,
  useDeleteSkillSource,
  useImportSkillFromGit,
  useSkillSources,
  useSkills,
  useSwitchSkillToGit,
  useSyncSkillSource,
  useUpdateSkillMeta,
  useUploadSkill,
} from '@/hooks/useSkills'
import { ApiClientError, api } from '@/lib/api/client'
import type { ApiCredentialMeta, ApiSkill, ApiSkillSource, SkillVisibility } from '@/lib/api/types'
import { formatFullTime, formatRelativeTime } from '@/lib/relative-time'
import type { SkillCategoryChip } from '@/lib/skill-categories'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  GitBranch,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  User,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EditSourceDialog } from './EditSourceDialog'
import { SkillCategoryChips } from './SkillCategoryChips'
import { SkillDetailView } from './SkillDetailView'
import { SkillTeamFilter } from './SkillTeamFilter'

export function SkillsSection({ instanceId }: { instanceId: string }) {
  const { t, i18n } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const headerSlot = useAppHeaderSlot()
  const [scopeFilter, setScopeFilter] = useInstancePersistentState<ScopeFilter>(
    instanceId,
    'skillsScopeFilter',
    () => 'all',
  )
  const [viewMode, setViewMode] = useInstancePersistentState<ResourceView>(
    instanceId,
    'skillsViewMode',
    () => 'card',
  )
  // Which skill, if any, is opened in the detail view. Persistent so a
  // refresh while reading a skill returns the user to the same page. p3:
  // selection key is now the skill UUID; the persistent key changed to
  // `skillsSelectedId` so stale name-keyed values from an older bundle
  // don't accidentally resolve.
  const [selectedSkillId, setSelectedSkillId] = useInstancePersistentState<string | null>(
    instanceId,
    'skillsSelectedId',
    () => null,
  )
  // Selected category chips. Persistent across sessions so a returning user
  // sees the same drill-in. Stored as an array, surfaced as a Set.
  const [selectedCategoryList, setSelectedCategoryList] = useInstancePersistentState<
    SkillCategoryChip[]
  >(instanceId, 'skillsCategoryChips', () => [])
  const selectedCategories = useMemo(
    () => new Set<SkillCategoryChip>(selectedCategoryList),
    [selectedCategoryList],
  )
  // Team filter for the "Shared with me" group — narrows to skills granted
  // via one team. Persistent so a returning user keeps their drill-in.
  // Applied client-side (off `shared_via_teams`); the server query is
  // unaware of it.
  const [selectedTeamId, setSelectedTeamId] = useInstancePersistentState<string | null>(
    instanceId,
    'skillsTeamFilter',
    () => null,
  )
  const [search, setSearch] = useState('')
  // 300ms debounce — fires the server query after the user pauses typing
  // (see CLAUDE/PR notes). Identity passthrough when search is empty.
  const debouncedSearch = useDebouncedValue(search, 300)

  // Single server query. We dropped chip/scope counts on purpose — they
  // required a second unfiltered fetch, and the value didn't justify the
  // moving parts. Server applies q + scope + categories together.
  const visibilityParam: SkillVisibility | undefined =
    scopeFilter === 'all' ? undefined : scopeFilter
  const { data: filteredSkills = [] } = useSkills({
    q: debouncedSearch,
    categories: selectedCategoryList,
    visibility: visibilityParam,
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<ApiSkill | null>(null)
  const [form, setForm] = useState<SkillFormState>(INITIAL_SKILL_FORM)
  const [credentials, setCredentials] = useState<ApiCredentialMeta[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareSkill, setShareSkill] = useState<ApiSkill | null>(null)
  const [exportSkill, setExportSkill] = useState<ApiSkill | null>(null)
  const [deletingSkill, setDeletingSkill] = useState<ApiSkill | null>(null)

  const importFromGit = useImportSkillFromGit()
  const switchToGit = useSwitchSkillToGit()
  // Open => the user clicked Save in git mode on a native skill; performed only
  // after they confirm the history wipe in the dialog below.
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const syncSource = useSyncSkillSource()
  const deleteSkill = useDeleteSkill()
  const deleteSource = useDeleteSkillSource()
  const updateMeta = useUpdateSkillMeta()
  const upload = useUploadSkill()
  // Owned sources only — used to enrich git group headers with repo + ref
  // and to gate source-level ops (Sync / Edit / Delete) to the owner.
  const { data: ownedSources = [] } = useSkillSources()
  const [editingSourceRow, setEditingSourceRow] = useState<ApiSkillSource | null>(null)

  // Fetch the source row when the user opens the edit dialog for a skill
  // backed by a git source. The form needs the source's URL / ref /
  // credential / last_synced_at to prefill and render the banner.
  const editingSourceId = editingSkill?.source_id ?? null
  const editingSourceQuery = useQuery<ApiSkillSource>({
    queryKey: ['skill-source', editingSourceId],
    queryFn: () => api.getSkillSource(editingSourceId as string),
    enabled: !!editingSourceId,
  })
  const editingSource = editingSourceQuery.data ?? null

  function loadCredentials() {
    api
      .listCredentials()
      .then(setCredentials)
      .catch(() => {})
  }

  // p3: a skill's git fields are on its source row, not on the skill row.
  // We can't preload them synchronously — we kick off the source query and
  // mirror the values into the form once it lands (effect below). For
  // native skills the source carries no git fields; we start in upload mode.
  function openEditDialog(skill: ApiSkill) {
    setEditingSkill(skill)
    setForm({
      ...INITIAL_SKILL_FORM,
      name: skill.name,
      description: skill.description,
      // Default to upload until we know the source kind. The effect below
      // promotes the mode to 'git' once the source resolves.
      mode: 'upload',
      gitUrl: '',
      gitType: 'github',
      tokenSource: 'none',
      selectedCredential: '',
      category: skill.category ?? '',
    })
    setError(null)
    loadCredentials()
    setDialogOpen(true)
  }

  // Once the source for the editing skill lands, mirror its git fields into
  // the form. This is cheap to re-run and idempotent: when the user has
  // already started typing, we don't overwrite their edits because the
  // effect only runs while the dialog is opening (editingSkill identity
  // changed) — see the deps below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  useEffect(() => {
    if (!editingSkill || !editingSource) return
    if (editingSource.kind !== 'git') return
    setForm((f) => ({
      ...f,
      mode: 'git',
      // Ref is its own field now — keep the URL clean (just the repo
      // root). Seed the selected subpath from the skill being edited so a
      // plain re-import works without a forced re-Scan; the user can still
      // Scan to change it. (Subpath is the required server selector.)
      gitUrl: editingSource.git_url ?? '',
      gitRef: editingSource.git_ref ?? '',
      gitType: editingSource.git_type === 'gitlab' ? 'gitlab' : 'github',
      tokenSource: editingSource.credential_name ? 'credential' : 'none',
      selectedCredential: editingSource.credential_name ?? '',
      subpaths: [editingSkill.subpath],
    }))
  }, [editingSkill?.id, editingSource?.id])

  // Compute the category patch payload — undefined if unchanged, `null` to
  // clear, or the chosen value. Empty string in the form means "clear".
  function categoryPatch(currentValue: string | null | undefined): string | null | undefined {
    const current = currentValue ?? ''
    if (form.category === current) return undefined
    return form.category === '' ? null : form.category
  }

  async function handleSave() {
    if (form.mode === 'git') {
      if (!form.gitUrl.trim()) {
        setError(t('components.library.skills.errors.gitUrlRequired'))
        return
      }
      // `subpath` is the required server selector. On edit-open it's seeded
      // from the skill being edited; if the user cleared it (e.g. re-Scanned a
      // multi-candidate repo without picking), block instead of sending an
      // empty selector that the server would reject with a Zod error.
      if (form.subpaths.length === 0) {
        setError(t('components.library.skills.errors.previewRequired'))
        return
      }
      // Native skill flipped into git mode = switch source in place. This is
      // destructive (wipes version history), so we gate on an explicit confirm
      // instead of running it straight from Save. performSwitchToGit() below
      // does the work once confirmed.
      if (editingSkill && editingSkill.source_kind === 'native') {
        setError(null)
        setConfirmSwitch(true)
        return
      }
      setIsSaving(true)
      setError(null)
      try {
        // Re-import via this dialog keeps existing visibility (server preserves
        // it on upsert when visibility is omitted? actually it requires it —
        // pass current value). For new imports from this re-edit path, the
        // editing skill's existing visibility is the right default.
        const imported = await importFromGit.mutateAsync({
          url: form.gitUrl.trim(),
          type: form.gitType,
          ref: form.gitRef.trim() || 'main',
          token: form.tokenSource === 'manual' ? form.gitToken.trim() || undefined : undefined,
          credential_name:
            form.tokenSource === 'credential' ? form.selectedCredential || undefined : undefined,
          name: form.name.trim() || undefined,
          description: form.description.trim() || undefined,
          visibility: editingSkill?.visibility ?? 'private',
          // SkillsSection's git form is a re-import / single-skill path (Edit
          // dialog stays single-pick by construction). Take the first
          // picked subpath; multi-select lives in CreateSkillDialog. Guarded
          // non-empty above, so this is always a concrete string ('' = root).
          subpath: form.subpaths[0],
        })
        // Category isn't part of the from-git body — server doesn't take it
        // on insert. Fold it into a follow-up PATCH when the user picked one
        // that differs from what the row already has.
        const catPatch = categoryPatch(imported.category)
        if (catPatch !== undefined) {
          await updateMeta.mutateAsync({ id: imported.id, meta: { category: catPatch } })
        }
        setDialogOpen(false)
        toast.success(
          editingSkill
            ? t('components.library.skills.toasts.reimported')
            : t('components.library.skills.toasts.imported'),
        )
      } catch (err) {
        // Multi-candidate fallback: scs returned 400 with a list of subpaths.
        // Surface them in the picker (without re-running scan-preview) so
        // the user can pick and click Save again.
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
            err instanceof Error ? err.message : t('components.library.skills.errors.importFailed')
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
      setError(t('components.library.skills.errors.nameRequired'))
      return
    }
    if (!editingSkill && !form.file) {
      setError(t('components.library.skills.errors.packageRequired'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      if (editingSkill) {
        const catPatch = categoryPatch(editingSkill.category)
        await updateMeta.mutateAsync({
          id: editingSkill.id,
          meta: { description: form.description, category: catPatch },
        })
        if (form.file) {
          // p3 dropped the per-skill `PUT /skills/:name` re-upload endpoint.
          // The replacement is draft-save + publish on the source; until the
          // native-authoring editor lands we fall back to the one-shot upload
          // which upserts by (user_id, name) and creates a fresh version.
          const buf = await form.file.arrayBuffer()
          await upload.mutateAsync({
            name: editingSkill.name,
            description: form.description,
            buffer: buf,
            visibility: editingSkill.visibility,
          })
        }
      } else {
        const buf = await form.file!.arrayBuffer()
        const created = await upload.mutateAsync({
          name: form.name.trim(),
          description: form.description,
          buffer: buf,
          visibility: 'private',
        })
        const catPatch = categoryPatch(created.category)
        if (catPatch !== undefined) {
          await updateMeta.mutateAsync({ id: created.id, meta: { category: catPatch } })
        }
      }
      setDialogOpen(false)
      toast.success(
        editingSkill
          ? t('components.library.skills.toasts.updated')
          : t('components.library.skills.toasts.uploaded'),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('components.library.skills.errors.saveFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  // Run the native→git source switch after the user confirms. Mirrors the
  // git-import path's validation + multi-candidate 400 fallback, but calls the
  // dedicated switch endpoint (preserves the skill UUID; wipes native history).
  async function performSwitchToGit() {
    if (!editingSkill) return
    setConfirmSwitch(false)
    setIsSaving(true)
    setError(null)
    try {
      await switchToGit.mutateAsync({
        id: editingSkill.id,
        body: {
          url: form.gitUrl.trim(),
          type: form.gitType,
          ref: form.gitRef.trim() || 'main',
          token: form.tokenSource === 'manual' ? form.gitToken.trim() || undefined : undefined,
          credential_name:
            form.tokenSource === 'credential' ? form.selectedCredential || undefined : undefined,
          subpath: form.subpaths[0],
        },
      })
      setDialogOpen(false)
      toast.success(t('components.library.skills.toasts.switchedToGit'))
    } catch (err) {
      // Same multi-candidate fallback as import: surface the subpaths in the
      // picker so the user can pick and confirm again.
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
          err instanceof Error ? err.message : t('components.library.skills.errors.switchFailed')
        setError(msg)
        toast.error(msg)
      }
    } finally {
      setIsSaving(false)
    }
  }

  // p3: sync is source-level — driven by the source group header. We
  // distinguish "changed" vs "no-op" so the toast reads correctly.
  function handleSyncSource(sourceId: string) {
    syncSource.mutate(sourceId, {
      onSuccess: (result) => {
        const changed = result.results.some((r) => r.changed)
        if (changed) {
          toast.success(t('components.library.skills.toasts.synced'))
        } else {
          toast.info(t('components.library.skills.toasts.alreadyUpToDate'))
        }
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : t('components.library.skills.errors.syncFailed'),
        )
      },
    })
  }

  function handleDelete(skillId: string) {
    // Optimistic delete already drops the row; close the preview dialog
    // immediately and let the toast report the outcome.
    setDeletingSkill(null)
    deleteSkill.mutate(skillId, {
      onSuccess: () => toast.success(t('components.library.skills.toasts.deleted')),
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : t('components.library.skills.errors.deleteFailed'),
        ),
    })
  }

  function toggleCategory(chip: SkillCategoryChip) {
    setSelectedCategoryList((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
    )
  }

  // Teams that have shared something with the user, derived from the
  // server-filtered list (i.e. before the team filter is applied) so the
  // options stay stable no matter which team is currently selected. Empty
  // when nothing is team-shared — the filter control then hides itself.
  const teamOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const skill of filteredSkills) {
      for (const tm of skill.shared_via_teams) {
        if (!byId.has(tm.id)) byId.set(tm.id, tm.name)
      }
    }
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredSkills])

  // Effective selection: ignore a stale id that no longer matches any
  // available team (e.g. after a category/search change dropped it), but
  // keep it in storage so it re-applies once the team reappears.
  const activeTeamId =
    selectedTeamId && teamOptions.some((tm) => tm.id === selectedTeamId) ? selectedTeamId : null

  // Server-filtered grid data, then the client-side team filter. Narrowing
  // to one team naturally collapses the owned groups (their skills carry no
  // `shared_via_teams`), leaving just that team's shared skills.
  const visibleSkills = useMemo(
    () =>
      activeTeamId
        ? filteredSkills.filter((s) => s.shared_via_teams.some((tm) => tm.id === activeTeamId))
        : filteredSkills,
    [filteredSkills, activeTeamId],
  )

  // Group skills into Library sections so source-level actions (Sync /
  // Edit / Delete source) live on a single header row instead of dangling
  // off every card. Three buckets:
  //   1. "Authored"      → my native skills (kind=native AND is_own)
  //   2. one per git source I own
  //   3. "Shared with me" → any skill I don't own (regardless of kind)
  // Empty git sources I own still show — that's the only place a user can
  // delete an orphaned source from.
  interface SkillGroup {
    key: string
    label: string
    kind: 'authored' | 'git' | 'shared'
    source?: ApiSkillSource
    skills: ApiSkill[]
  }
  const groups = useMemo<SkillGroup[]>(() => {
    const ownedMap = new Map(ownedSources.map((s) => [s.id, s]))
    const authored: ApiSkill[] = []
    const sharedWithMe: ApiSkill[] = []
    const byGitSource = new Map<string, ApiSkill[]>()
    for (const skill of visibleSkills) {
      if (!skill.is_own) {
        sharedWithMe.push(skill)
        continue
      }
      if (skill.source_kind === 'native') {
        authored.push(skill)
        continue
      }
      const list = byGitSource.get(skill.source_id) ?? []
      list.push(skill)
      byGitSource.set(skill.source_id, list)
    }
    // Empty git sources I own — surface ONLY when the source is truly
    // orphaned (skill_count === 0). A source with skills but none visible
    // under current filters is "filter empty" and should be hidden instead.
    for (const src of ownedSources) {
      if (src.kind !== 'git') continue
      if (byGitSource.has(src.id)) continue
      if (src.skill_count === 0) byGitSource.set(src.id, [])
    }
    const out: SkillGroup[] = []
    if (authored.length > 0) {
      out.push({
        key: 'authored',
        label: t('components.library.sources.groups.authored'),
        kind: 'authored',
        skills: authored,
      })
    }
    const gitGroups: SkillGroup[] = []
    for (const [sid, gitSkills] of byGitSource) {
      const src = ownedMap.get(sid)
      const label = src
        ? [src.git_host, src.git_owner, src.git_repo].filter(Boolean).join('/') +
          (src.git_ref ? ` @${src.git_ref}` : '')
        : t('components.library.sources.groups.git')
      gitGroups.push({
        key: `git:${sid}`,
        label,
        kind: 'git',
        source: src,
        skills: gitSkills,
      })
    }
    // Empty git sources sink to the bottom — they're orphans the user may
    // want to clean up, not active sources.
    gitGroups.sort((a, b) => {
      const aEmpty = a.skills.length === 0 ? 1 : 0
      const bEmpty = b.skills.length === 0 ? 1 : 0
      if (aEmpty !== bEmpty) return aEmpty - bEmpty
      return a.label.localeCompare(b.label)
    })
    out.push(...gitGroups)
    if (sharedWithMe.length > 0) {
      out.push({
        key: 'shared',
        label: t('components.library.sources.groups.shared'),
        kind: 'shared',
        skills: sharedWithMe,
      })
    }
    return out
  }, [visibleSkills, ownedSources, t])

  const getSourceSkillCount = (srcId: string) =>
    groups.find((g) => g.source?.id === srcId)?.skills.length ?? 0

  const handleDeleteSource = (src: ApiSkillSource) => {
    deleteSource.mutate(src.id, {
      onSuccess: () => toast.success(t('components.library.sources.toasts.deleted')),
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : t('components.library.sources.errors.deleteFailed'),
        ),
    })
  }

  const openCreate = () => openDialog('create-skill')

  // Detail mode: a skill is opened. The detail view paints its own header
  // (back + name + scope) and replaces the list/grid + tab-strip tooling
  // entirely. Resolution comes from the current filtered list — if a chip /
  // scope / search hides the persisted selection it stays in storage but
  // we don't try to enter detail mode (the user can clear filters to get
  // back in). We don't auto-drop the persisted name on "not found in this
  // list" because that's now ambiguous (filtered out vs deleted).
  const selectedSkill = selectedSkillId
    ? (filteredSkills.find((s) => s.id === selectedSkillId) ?? null)
    : null

  if (selectedSkill) {
    return <SkillDetailView skill={selectedSkill} onBack={() => setSelectedSkillId(null)} />
  }

  // "Is anything currently narrowing the list?" — drives the empty-state
  // copy. We can't distinguish "no skills exist" from "all skills filtered
  // out" without a second unfiltered query (we dropped it on purpose), so
  // when a filter is active we show the "no match" message instead of the
  // first-run empty hero.
  const isFiltered =
    !!debouncedSearch.trim() ||
    selectedCategoryList.length > 0 ||
    scopeFilter !== 'all' ||
    activeTeamId !== null

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.library.skills.actions.new')}
              onClick={openCreate}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <ResourceFilterTabs value={scopeFilter} onValueChange={setScopeFilter} />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <ResourceViewToggle value={viewMode} onValueChange={setViewMode} />
          </>,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto">
        {/*
         * Sticky filter bar: chips + search co-locate to take advantage of
         * the wider body row (vs the cramped header). `top-0` pins it as
         * the user scrolls the grid. `-mx` zero — bar honors the same p-4
         * gutter as the grid so chip wrapping aligns with cards below.
         */}
        <div className="sticky top-0 z-10 border-b border-foreground/[0.06] bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <SkillCategoryChips selected={selectedCategories} onToggle={toggleCategory} />
            </div>
            <SkillTeamFilter
              teams={teamOptions}
              value={activeTeamId}
              onChange={setSelectedTeamId}
            />
            <AppHeaderSearch value={search} onChange={setSearch} width="md" />
          </div>
        </div>

        <div className="p-4">
          {filteredSkills.length === 0 && !isFiltered ? (
            <EmptyHero
              className="min-h-[16rem]"
              illustration={<EmptyIllustration src="prompts" size="h-32" />}
              title={t('components.library.skills.empty.noSkills')}
              action={
                <Button type="button" size="sm" variant="outline" onClick={openCreate}>
                  <Plus className="mr-1 h-3 w-3" />
                  {t('components.library.skills.actions.new')}
                </Button>
              }
            />
          ) : visibleSkills.length === 0 ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-center text-xs text-muted-foreground">
              {t('components.resource.filter.empty')}
            </div>
          ) : (
            (() => {
              const renderActions = (s: ApiSkill) =>
                (s.is_own || s.my_permission === 'editor') && (
                  <>
                    {/* p3: per-skill Sync was wrong abstraction — moved up to
                        the source group header so one Sync per repo covers
                        all skills under it. */}
                    {s.is_own && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => setShareSkill(s)}
                        title={t('components.library.skills.actions.share')}
                      >
                        <Share2 className="h-3 w-3" />
                      </Button>
                    )}
                    {/* Distinct from Share2 above: that governs who inside the
                        platform can see the skill, this hands it to a local
                        agent over a public URL. Different verbs on purpose. */}
                    {s.is_own && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => setExportSkill(s)}
                        title={t('components.library.skills.actions.export')}
                      >
                        <Link2 className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => openEditDialog(s)}
                      title={t('components.library.skills.actions.edit')}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {s.is_own && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        disabled={deleteSkill.isPending}
                        onClick={() => setDeletingSkill(s)}
                        title={t('components.library.skills.actions.delete')}
                      >
                        {deleteSkill.isPending && deleteSkill.variables === s.id ? (
                          <Spinner size="sm" className="h-3 w-3" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </>
                )

              const renderGroupBody = (skills: ApiSkill[]) => {
                if (skills.length === 0) {
                  return (
                    <div className="rounded border border-dashed border-foreground/[0.12] px-3 py-4 text-center text-xs text-muted-foreground">
                      {t('components.library.sources.emptySource')}
                    </div>
                  )
                }
                if (viewMode === 'list') {
                  return (
                    <ResourceList>
                      {skills.map((s) => {
                        // Owner name surfaces only in the "Shared with me"
                        // group; for owned-skill groups it'd be visual noise.
                        const author =
                          !s.is_own && s.owner_name
                            ? t('components.library.skills.labels.byOwner', { owner: s.owner_name })
                            : null
                        return (
                          <ResourceListItem
                            key={s.id}
                            title={s.name}
                            subtitle={s.description || undefined}
                            onClick={() => setSelectedSkillId(s.id)}
                            trailing={
                              <>
                                {author && <span className="truncate">{author}</span>}
                                {s.updated_at && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="shrink-0 cursor-default tabular-nums">
                                        {formatRelativeTime(s.updated_at, i18n.language)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs tabular-nums">
                                      {formatFullTime(s.updated_at, i18n.language)}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {s.is_own && (
                                  <span className="font-medium text-primary">
                                    {t('components.resource.ownership.yours')}
                                  </span>
                                )}
                                <ScopeBadge scope={s.visibility} />
                              </>
                            }
                            actions={renderActions(s)}
                          />
                        )
                      })}
                    </ResourceList>
                  )
                }
                return (
                  <ResourceGrid>
                    {skills.map((s) => (
                      <ResourceCard
                        key={s.id}
                        name={s.name}
                        description={s.description || undefined}
                        onClick={() => setSelectedSkillId(s.id)}
                        typeIcon={undefined}
                        type={undefined}
                        meta={(() => {
                          const author =
                            !s.is_own && s.owner_name
                              ? t('components.library.skills.labels.byOwner', {
                                  owner: s.owner_name,
                                })
                              : null
                          if (!author && !s.updated_at) return undefined
                          return (
                            <>
                              {author && <span className="truncate">{author}</span>}
                              {author && s.updated_at && <span aria-hidden> · </span>}
                              {s.updated_at && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-default tabular-nums">
                                      {formatRelativeTime(s.updated_at, i18n.language)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs tabular-nums">
                                    {formatFullTime(s.updated_at, i18n.language)}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </>
                          )
                        })()}
                        scope={s.visibility}
                        owned={s.is_own}
                        actions={renderActions(s)}
                      />
                    ))}
                  </ResourceGrid>
                )
              }

              return (
                <div className="space-y-6">
                  {groups.map((group) => {
                    const GroupIcon =
                      group.kind === 'git' ? GitBranch : group.kind === 'shared' ? Share2 : User
                    const isGitOwned = group.kind === 'git' && !!group.source
                    return (
                      <section key={group.key} className="space-y-2">
                        <div className="flex min-w-0 items-center gap-2 border-b border-foreground/[0.06] pb-2">
                          <GroupIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-medium">{group.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            ({group.skills.length})
                          </span>
                          {isGitOwned && group.source && (
                            <>
                              <span className="ml-auto" />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 gap-1 px-2 text-xs"
                                disabled={
                                  syncSource.isPending && syncSource.variables === group.source.id
                                }
                                onClick={() => handleSyncSource(group.source!.id)}
                              >
                                {syncSource.isPending &&
                                syncSource.variables === group.source.id ? (
                                  <Spinner size="sm" className="h-3 w-3" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                {t('components.library.skills.actions.syncFromGit')}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                    title={t('components.library.sources.moreActions')}
                                  >
                                    <MoreVertical className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    onClick={() => setEditingSourceRow(group.source!)}
                                  >
                                    <Pencil className="mr-2 h-3 w-3" />
                                    {t('components.library.sources.actions.edit')}
                                  </DropdownMenuItem>
                                  <ConfirmMenuItem
                                    icon={<Trash2 className="mr-2 h-3 w-3" />}
                                    confirmIcon={<Trash2 className="mr-2 h-3 w-3" />}
                                    confirmLabel={t(
                                      getSourceSkillCount(group.source!.id) > 0
                                        ? 'components.library.sources.confirmDeleteArmedWithSkills'
                                        : 'components.library.sources.confirmDeleteArmedEmpty',
                                      { count: getSourceSkillCount(group.source!.id) },
                                    )}
                                    onConfirm={() => handleDeleteSource(group.source!)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    {t('components.library.sources.actions.delete')}
                                  </ConfirmMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </div>
                        {renderGroupBody(group.skills)}
                      </section>
                    )
                  })}
                </div>
              )
            })()
          )}
        </div>
      </div>

      <DocumentedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editingSkill
            ? t('components.library.skills.dialogs.edit.title')
            : t('components.library.skills.dialogs.add.title')
        }
        docs={getSkillDoc(form.mode)}
        docsHint={getSkillDocsHint()}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={isSaving}
              onClick={handleSave}
              label={t('common.save')}
              // Git import/re-import needs a picked subpath (the required
              // server selector); nudge to Preview first. Upload unaffected.
              disabled={form.mode === 'git' && form.subpaths.length === 0}
            />
          </>
        }
      >
        <SkillFormFields
          form={form}
          setForm={setForm}
          credentials={credentials}
          editingSkill={editingSkill}
          editingSource={editingSource}
          idPrefix="edit-skill"
        />
        {error && <div className="mt-3 text-xs text-destructive">{error}</div>}
      </DocumentedDialog>

      <SkillShareDialog
        skill={shareSkill}
        open={!!shareSkill}
        onOpenChange={(o) => !o && setShareSkill(null)}
      />

      <SkillExportDialog
        skill={exportSkill}
        open={!!exportSkill}
        onOpenChange={(o) => !o && setExportSkill(null)}
      />

      <SkillDeleteDialog
        skill={deletingSkill}
        open={!!deletingSkill}
        onOpenChange={(o) => !o && setDeletingSkill(null)}
        onConfirm={handleDelete}
        pending={deleteSkill.isPending}
      />

      <EditSourceDialog
        source={editingSourceRow}
        open={!!editingSourceRow}
        onOpenChange={(o) => !o && setEditingSourceRow(null)}
      />

      <Dialog open={confirmSwitch} onOpenChange={(o) => !o && setConfirmSwitch(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('components.library.skills.switchDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('components.library.skills.switchDialog.body', {
                name: editingSkill?.name ?? '',
              })}
            </p>
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-tiny text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('components.library.skills.switchDialog.warning')}</span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmSwitch(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={switchToGit.isPending}
                onClick={performSwitchToGit}
              >
                {switchToGit.isPending
                  ? t('components.library.skills.switchDialog.switching')
                  : t('components.library.skills.switchDialog.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
