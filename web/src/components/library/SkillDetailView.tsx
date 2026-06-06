/**
 * Tree + file viewer for a single skill from the central catalog.
 *
 * Two modes:
 *   - **view** (default): read-only browse of the active version. Data comes
 *     from the visibility-gated CP proxy `/api/skills/:id/{dirs,files}`.
 *   - **editing**: per-file edits land in the source's draft scratch on scs;
 *     "Save Draft" PUTs each dirty file, "Publish" promotes the draft to a
 *     new version. Available when `my_permission ∈ {owner, editor}` and the
 *     skill's source is `kind=native`.
 *
 * Deliberately *not* layered on top of `SkillBrowserShell` — that shell
 * carries workspace-flavored chrome (picker / DnD / mark-editing) the library
 * surface doesn't want.
 */
import { ScopeBadge } from '@/components/resource/ScopeBadge'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type DufsEntry, isDir } from '@/components/workspace/file-operations'
import { FilePreview } from '@/components/workspace/file-preview/FilePreview'
import { useSetSkillActiveVersion, useSkillVersions } from '@/hooks/useSkills'
import { api } from '@/lib/api/client'
import type { ApiSkill } from '@/lib/api/types'
import { formatFullTime, formatRelativeTime } from '@/lib/relative-time'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  History,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface SkillDetailViewProps {
  skill: ApiSkill
  onBack: () => void
}

interface DirListResponse {
  entries: DufsEntry[]
}

function dirUrl(id: string, path: string, version: string | null): string {
  const v = version ? `&version=${encodeURIComponent(version)}` : ''
  return `/api/skills/${encodeURIComponent(id)}/dirs?path=${encodeURIComponent(path)}${v}`
}

function fileUrl(id: string, path: string, version: string | null): string {
  const v = version ? `&version=${encodeURIComponent(version)}` : ''
  return `/api/skills/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}${v}`
}

async function fetchDir(id: string, subPath: string, version: string | null): Promise<DufsEntry[]> {
  const resp = await fetch(dirUrl(id, subPath || '/', version), { credentials: 'include' })
  if (!resp.ok) throw new Error(`dir list failed: ${resp.status}`)
  const data: DirListResponse = await resp.json()
  return data.entries ?? []
}

async function fetchFileText(id: string, path: string, version: string | null): Promise<string> {
  const resp = await fetch(fileUrl(id, path, version), { credentials: 'include' })
  if (!resp.ok) throw new Error(`file fetch failed: ${resp.status}`)
  return resp.text()
}

// Dir/file caches scope by skill + version so switching versions doesn't
// reuse stale entries from the previous tarball.
const rootDirQueryKey = (id: string, v: string | null) => ['skill-detail-dir', id, v, ''] as const
const subDirQueryKey = (id: string, v: string | null, sub: string) =>
  ['skill-detail-dir', id, v, sub] as const
const fileQueryKey = (id: string, v: string | null, path: string) =>
  ['skill-detail-file', id, v, path] as const
const draftTreeQueryKey = (sourceId: string) => ['skill-detail-draft-tree', sourceId] as const
const draftFileQueryKey = (sourceId: string, path: string) =>
  ['skill-detail-draft-file', sourceId, path] as const

interface DraftNode {
  path: string
  type: 'file' | 'dir'
  size?: number
}

/**
 * Reshape the flat draft listing into a per-dir map of DufsEntry rows. Keys
 * are the leading-slash directory paths the renderer expects (root = '/').
 */
function buildDraftDirMap(nodes: DraftNode[]): Record<string, DufsEntry[]> {
  const map: Record<string, DufsEntry[]> = { '/': [] }
  for (const n of nodes) {
    const segments = n.path.split('/').filter(Boolean)
    const name = segments[segments.length - 1]
    const parent = segments.length <= 1 ? '/' : `/${segments.slice(0, -1).join('/')}`
    if (!map[parent]) map[parent] = []
    map[parent].push({
      name,
      path_type: n.type === 'dir' ? 'Dir' : 'File',
      mtime: 0,
      size: n.size ?? 0,
    })
    if (n.type === 'dir') {
      const key = `/${segments.join('/')}`
      if (!map[key]) map[key] = []
    }
  }
  return map
}

export function SkillDetailView({ skill, onBack }: SkillDetailViewProps) {
  const { t, i18n } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const qc = useQueryClient()

  const [expandedArr, setExpandedArr] = useState<string[]>([])
  const expanded = useMemo(() => new Set(expandedArr), [expandedArr])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // ── editor state ────────────────────────────────────────────────────────
  // The Edit button is gated on source_kind === 'native' and editor/owner
  // permission, so once we flip to 'editing' we already know skill.source_id
  // refers to a native source — no extra source fetch needed.
  const [mode, setMode] = useState<'view' | 'editing'>('view')
  // null = active version (don't pass `?version` — server picks default).
  // Once the user picks a non-active row from the dropdown we pin to its id.
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const canEdit =
    skill.source_kind === 'native' &&
    (skill.my_permission === 'owner' || skill.my_permission === 'editor') &&
    mode === 'view'

  const sourceId = skill.source_id

  const lastSkillRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastSkillRef.current !== skill.id) {
      lastSkillRef.current = skill.id
      setExpandedArr([])
      setSelectedPath(null)
      setMode('view')
      setDirty(new Map())
      setViewingVersionId(null)
    }
  }, [skill.id])

  // ── versions ────────────────────────────────────────────────────────────
  // Fetched eagerly in view mode so the header dropdown can render the list
  // without a flash on open. Cheap call; one row per published version.
  const versionsQuery = useSkillVersions(mode === 'view' ? skill.id : null)
  const versions = versionsQuery.data ?? []
  const setActive = useSetSkillActiveVersion()
  const canSwitchActive = skill.my_permission === 'owner'
  // Resolve the version actually being viewed: explicit pick overrides; else
  // the active version (if the row carries one). `viewingVersionId` may be
  // null while versions are loading or when no version exists.
  const effectiveVersionId = viewingVersionId ?? skill.active_version_id ?? null
  const isActiveSelected = !viewingVersionId || viewingVersionId === skill.active_version_id
  const selectedVersion = effectiveVersionId
    ? (versions.find((v) => v.id === effectiveVersionId) ?? null)
    : null

  // ── data: view mode (active or pinned version) ─────────────────────────
  // Bind fetches to the *resolved* version id (effectiveVersionId), not the
  // raw `viewingVersionId` state. Two reasons:
  //   1. Keeps the cache key stable: viewing the active version always lands
  //      under ['file', id, activeId, path] regardless of whether the user
  //      arrived via "null = follow active" or by clicking the active row.
  //   2. Makes the URL deterministic — every request carries `?version=…`,
  //      so the browser HTTP cache never collides a "no version" entry with
  //      a versioned one.
  const viewVersionForFetch = effectiveVersionId
  const rootQuery = useQuery<DufsEntry[]>({
    queryKey: rootDirQueryKey(skill.id, viewVersionForFetch),
    queryFn: () => fetchDir(skill.id, '/', viewVersionForFetch),
    enabled: mode === 'view',
  })

  const [showSlowHint, setShowSlowHint] = useState(false)
  useEffect(() => {
    if (!rootQuery.isLoading) {
      setShowSlowHint(false)
      return
    }
    const handle = setTimeout(() => setShowSlowHint(true), 1000)
    return () => clearTimeout(handle)
  }, [rootQuery.isLoading])

  const subQueries = useQueries({
    queries: expandedArr.map((sub) => ({
      queryKey: subDirQueryKey(skill.id, viewVersionForFetch, sub),
      queryFn: () => fetchDir(skill.id, sub, viewVersionForFetch),
      enabled: mode === 'view',
    })),
  })
  const subEntries = useMemo<Record<string, DufsEntry[] | undefined>>(() => {
    const out: Record<string, DufsEntry[] | undefined> = {}
    expandedArr.forEach((sub, i) => {
      out[sub] = subQueries[i]?.data
    })
    return out
  }, [expandedArr, subQueries])
  const loadingDirs = useMemo<Set<string>>(() => {
    const out = new Set<string>()
    expandedArr.forEach((sub, i) => {
      const q = subQueries[i]
      if (q?.isLoading || (q && !q.data && !q.isError)) out.add(sub)
    })
    return out
  }, [expandedArr, subQueries])

  // ── data: editing mode (draft scratch tree) ────────────────────────────
  const draftTreeQuery = useQuery({
    queryKey: draftTreeQueryKey(sourceId),
    queryFn: () => api.listDraftFiles(sourceId) as Promise<DraftNode[]>,
    enabled: mode === 'editing',
  })
  const draftDirMap = useMemo(
    () => (draftTreeQuery.data ? buildDraftDirMap(draftTreeQuery.data) : { '/': [] }),
    [draftTreeQuery.data],
  )

  const rootEntries = mode === 'editing' ? (draftDirMap['/'] ?? []) : (rootQuery.data ?? [])

  // Auto-open SKILL.md on first land (view mode only — editing inherits the
  // selection from view).
  const autoSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'view') return
    if (selectedPath || !rootQuery.isSuccess) return
    if (autoSelectedRef.current === skill.id) return
    autoSelectedRef.current = skill.id
    const head =
      rootEntries.find((e) => e.name === 'SKILL.md') ??
      rootEntries.find((e) => e.name.toLowerCase() === 'readme.md')
    if (head) setSelectedPath(`/${head.name}`)
  }, [rootEntries, rootQuery.isSuccess, selectedPath, skill.id, mode])

  // ── file content ────────────────────────────────────────────────────────
  // Draft files come back as raw bytes; we only try to decode as UTF-8
  // text when we're going to render them as text. `fatal: true` ensures
  // binary blobs (images, fonts, archives, …) don't get silently mangled
  // into U+FFFD sequences and then re-encoded to UTF-8 on save — the
  // round-trip would corrupt the file. On decode failure we surface a
  // `kind: 'binary'` sentinel and the UI refuses to edit it.
  type DraftFile = { kind: 'text'; text: string } | { kind: 'binary'; size: number }
  const draftFileQuery = useQuery<DraftFile>({
    queryKey: selectedPath
      ? draftFileQueryKey(sourceId, selectedPath)
      : ['skill-detail-draft-file', '_none'],
    queryFn: async () => {
      const ab = await api.readDraftFile(sourceId, selectedPath!.replace(/^\//, ''))
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(ab))
        return { kind: 'text', text }
      } catch {
        return { kind: 'binary', size: ab.byteLength }
      }
    },
    enabled: mode === 'editing' && !!selectedPath,
  })
  const draftIsBinary = mode === 'editing' && draftFileQuery.data?.kind === 'binary'

  const viewFileQuery = useQuery<string>({
    queryKey: selectedPath
      ? fileQueryKey(skill.id, viewVersionForFetch, selectedPath)
      : ['skill-detail-file', '_none'],
    queryFn: () => fetchFileText(skill.id, selectedPath!, viewVersionForFetch),
    enabled: mode === 'view' && !!selectedPath,
    // Per-version content is immutable. Never refetch a hit — and don't
    // reuse a stale cached entry from a previous version when the key flips.
    staleTime: Number.POSITIVE_INFINITY,
  })

  const baselineContent =
    mode === 'editing'
      ? draftFileQuery.data?.kind === 'text'
        ? draftFileQuery.data.text
        : ''
      : (viewFileQuery.data ?? '')
  const displayContent = useMemo(() => {
    if (mode === 'editing' && selectedPath && dirty.has(selectedPath)) {
      return dirty.get(selectedPath) ?? ''
    }
    return baselineContent
  }, [baselineContent, dirty, mode, selectedPath])

  const fileLoading = mode === 'editing' ? draftFileQuery.isLoading : viewFileQuery.isLoading
  const fileError = mode === 'editing' ? draftFileQuery.error : viewFileQuery.error

  // ── handlers ────────────────────────────────────────────────────────────
  const enterEdit = useCallback(() => {
    setMode('editing')
  }, [])

  const exitEdit = useCallback(() => {
    setMode('view')
    setDirty(new Map())
  }, [])

  const onContentChange = useCallback(
    (value: string) => {
      if (mode !== 'editing' || !selectedPath) return
      // Defense in depth: even if a binary file somehow mounted an editor,
      // refuse to track its edits — saving would replace the bytes with
      // UTF-8 of whatever the editor produced.
      if (draftIsBinary) return
      setDirty((prev) => {
        const next = new Map(prev)
        next.set(selectedPath, value)
        return next
      })
    },
    [draftIsBinary, mode, selectedPath],
  )

  const saveDraft = useCallback(async () => {
    if (dirty.size === 0 || saving) return
    setSaving(true)
    try {
      for (const [path, content] of dirty) {
        const bytes = new TextEncoder().encode(content)
        await api.writeDraftFile(sourceId, path.replace(/^\//, ''), bytes)
      }
      setDirty(new Map())
      // Refetch draft tree + currently-open file so the saved bytes round-trip
      // and the user sees what scs actually persisted.
      await Promise.all([
        qc.invalidateQueries({ queryKey: draftTreeQueryKey(sourceId) }),
        selectedPath
          ? qc.invalidateQueries({ queryKey: draftFileQueryKey(sourceId, selectedPath) })
          : Promise.resolve(),
      ])
      toast.success(t('components.library.skills.editor.toasts.draftSaved'))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }, [dirty, qc, saving, selectedPath, sourceId, t])

  const discardDraft = useCallback(async () => {
    try {
      await api.discardSkillDraft(sourceId)
      setDirty(new Map())
      await qc.invalidateQueries({ queryKey: draftTreeQueryKey(sourceId) })
      toast.success(t('components.library.skills.editor.toasts.draftDiscarded'))
      exitEdit()
    } catch (e: any) {
      toast.error(e.message)
    }
  }, [exitEdit, qc, sourceId, t])

  const publish = useCallback(async () => {
    if (publishing) return
    // Flush any pending edits first so publish reflects the latest state.
    if (dirty.size > 0) {
      await saveDraft()
    }
    setPublishing(true)
    try {
      await api.publishSkill(skill.id)
      toast.success(t('components.library.skills.editor.toasts.published'))
      // Active version moved — invalidate every cache scoped to this skill
      // (root + all expanded subdir listings + every loaded file content) and
      // the library list (active_version_id / updated_at). Workspace clients
      // refetch on their own via the server-side SSE reload notification.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['skill-detail-dir', skill.id] }),
        qc.invalidateQueries({ queryKey: ['skill-detail-file', skill.id] }),
        qc.invalidateQueries({ queryKey: ['skills'] }),
      ])
      exitEdit()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPublishing(false)
    }
  }, [dirty.size, exitEdit, publishing, qc, saveDraft, skill.id, t])

  const toggleDir = useCallback((path: string) => {
    setExpandedArr((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    )
  }, [])

  // ── tree rendering ──────────────────────────────────────────────────────
  // editing mode supplies sub-entries from `draftDirMap`; view mode supplies
  // them from per-dir queries.
  const renderEntries = (entries: DufsEntry[], parent = ''): React.ReactNode => {
    const sorted = [...entries].sort((a, b) => {
      if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return sorted.map((entry) => {
      const entryPath = `${parent}/${entry.name}`
      if (isDir(entry)) {
        const open = expanded.has(entryPath)
        const FolderIcon = open ? FolderOpen : Folder
        const dirLoading = mode === 'view' && open && loadingDirs.has(entryPath)
        const sub =
          mode === 'editing' ? (draftDirMap[entryPath] ?? []) : (subEntries[entryPath] ?? [])
        return (
          <div key={entryPath} className="group">
            {/* biome-ignore lint/a11y/useSemanticElements: row uses div + role=button for consistency with workspace tree */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleDir(entryPath)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleDir(entryPath)
                }
              }}
              className="flex min-w-0 cursor-default select-none items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-foreground/[0.04]"
            >
              {dirLoading ? (
                <Spinner className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight
                  className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                />
              )}
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{entry.name}</span>
            </div>
            {open && !dirLoading && (
              <div className="ml-3 border-l border-foreground/[0.08] pl-1">
                {renderEntries(sub, entryPath)}
              </div>
            )}
          </div>
        )
      }
      const selected = selectedPath === entryPath
      const isDirty = mode === 'editing' && dirty.has(entryPath)
      return (
        <div key={entryPath} className="group">
          {/* biome-ignore lint/a11y/useSemanticElements: row uses div + role=button for consistency with workspace tree */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedPath(entryPath)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelectedPath(entryPath)
              }
            }}
            className={`flex min-w-0 cursor-default select-none items-center gap-1.5 rounded px-2 py-1 text-xs ${
              selected ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.04]'
            }`}
          >
            <span className="w-3" />
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.name}</span>
            {isDirty && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-warning" />}
          </div>
        </div>
      )
    })
  }

  const selectedFilename = selectedPath?.split('/').pop() ?? ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerSlot &&
        createPortal(
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="h-3 w-3" />
              {t('components.library.skills.actions.back')}
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.1]" />
            <span className="truncate text-xs font-medium">{skill.name}</span>
            <ScopeBadge scope={skill.visibility} />
            {!skill.is_own && skill.owner_name && (
              <span className="truncate text-xs text-muted-foreground">
                {t('components.library.skills.labels.byOwner', { owner: skill.owner_name })}
              </span>
            )}
            <span className="flex items-center gap-1">
              {mode === 'view' && versions.length > 0 && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-2 text-xs"
                        title={t('components.library.skills.versions.actions.viewVersions')}
                      >
                        <History className="h-3 w-3" />
                        {selectedVersion ? (
                          <>
                            <span className="font-mono">
                              {(selectedVersion.commit_sha ?? selectedVersion.content_hash).slice(
                                0,
                                7,
                              )}
                            </span>
                            {isActiveSelected && (
                              <span className="text-[10px] text-muted-foreground">
                                · {t('components.library.skills.versions.activeBadge')}
                              </span>
                            )}
                          </>
                        ) : (
                          t('components.library.skills.versions.actions.viewVersions')
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72 p-1">
                      <ScrollArea className="max-h-80">
                        <div className="flex flex-col">
                          {versions.map((v) => {
                            const isActive = v.id === skill.active_version_id
                            const isPicked = v.id === effectiveVersionId
                            const short = (v.commit_sha ?? v.content_hash).slice(0, 7)
                            return (
                              <DropdownMenuItem
                                key={v.id}
                                onSelect={() => setViewingVersionId(isActive ? null : v.id)}
                                className={`flex min-w-0 flex-col items-start gap-0.5 px-2 py-1.5 text-xs ${
                                  isPicked ? 'bg-foreground/[0.08]' : ''
                                }`}
                              >
                                <div className="flex w-full min-w-0 items-center gap-1.5">
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {short}
                                  </span>
                                  {isActive && (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                                      <Check className="h-2.5 w-2.5" />
                                      {t('components.library.skills.versions.activeBadge')}
                                    </span>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="ml-auto shrink-0 cursor-default text-[10px] text-muted-foreground tabular-nums">
                                        {formatRelativeTime(v.published_at, i18n.language)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs tabular-nums">
                                      {formatFullTime(v.published_at, i18n.language)}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                {v.note?.trim() && (
                                  <div className="w-full truncate text-muted-foreground">
                                    {v.note}
                                  </div>
                                )}
                              </DropdownMenuItem>
                            )
                          })}
                        </div>
                      </ScrollArea>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {selectedVersion && (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-xs"
                      title={t('components.library.skills.versions.actions.download')}
                    >
                      <a
                        href={`/api/skills/${encodeURIComponent(skill.id)}/versions/${encodeURIComponent(selectedVersion.id)}/package`}
                        download
                      >
                        <Download className="h-3 w-3" />
                        {t('components.library.skills.versions.actions.download')}
                      </a>
                    </Button>
                  )}
                  {selectedVersion &&
                    canSwitchActive &&
                    (!isActiveSelected || setActive.isPending) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-6 px-2 text-xs"
                        disabled={setActive.isPending}
                        onClick={() => {
                          setActive.mutate(
                            { skillId: skill.id, versionId: selectedVersion.id },
                            {
                              onSuccess: () => {
                                toast.success(
                                  t('components.library.skills.versions.toasts.activated'),
                                )
                                // Snap back to "active" pinning so the row no
                                // longer shows the Use-this-version CTA.
                                setViewingVersionId(null)
                              },
                              onError: (e: any) => toast.error(e?.message ?? 'failed'),
                            },
                          )
                        }}
                      >
                        {setActive.isPending ? (
                          <Spinner className="h-3 w-3" />
                        ) : (
                          t('components.library.skills.versions.actions.setActive')
                        )}
                      </Button>
                    )}
                </>
              )}
              {mode === 'view' && canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={enterEdit}
                >
                  {t('components.library.skills.editor.actions.edit')}
                </Button>
              )}
              {mode === 'editing' && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {t('components.library.skills.editor.dirtyCount', { count: dirty.size })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    disabled={saving || dirty.size === 0}
                    onClick={saveDraft}
                  >
                    {saving ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      t('components.library.skills.editor.actions.saveDraft')
                    )}
                  </Button>
                  <ConfirmButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    icon={null}
                    confirmIcon={null}
                    confirmLabel={t('components.library.skills.editor.actions.discardArmed')}
                    onConfirm={discardDraft}
                  >
                    {t('components.library.skills.editor.actions.discard')}
                  </ConfirmButton>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-6 px-2 text-xs"
                    disabled={publishing}
                    onClick={publish}
                  >
                    {publishing ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      t('components.library.skills.editor.actions.publish')
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={exitEdit}
                  >
                    {t('components.library.skills.editor.actions.exit')}
                  </Button>
                </>
              )}
            </span>
          </>,
          headerSlot,
        )}

      {skill.description && <SkillDescription text={skill.description} />}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-border">
          <ScrollArea className="flex-1">
            <div className="p-1">
              {mode === 'view' && rootQuery.isLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                  <Spinner size="sm" />
                  {showSlowHint && (
                    <div className="max-w-[14rem] px-2 text-xs text-muted-foreground">
                      {t('components.library.skills.detail.unpackingHint')}
                    </div>
                  )}
                </div>
              ) : mode === 'view' && rootQuery.isError ? (
                <div className="px-2 py-4 text-center text-xs text-destructive">
                  {(rootQuery.error as Error).message}
                </div>
              ) : mode === 'editing' && draftTreeQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Spinner size="sm" />
                </div>
              ) : mode === 'editing' && draftTreeQuery.isError ? (
                <div className="px-2 py-4 text-center text-xs text-destructive">
                  {(draftTreeQuery.error as Error).message}
                </div>
              ) : rootEntries.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {t('components.workspaceSkillsPanel.empty.empty')}
                </div>
              ) : (
                renderEntries(rootEntries)
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedPath ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t('components.workspaceSkillsPanel.empty.selectFile')}
            </div>
          ) : fileLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : fileError ? (
            <div className="flex h-full items-center justify-center text-xs text-destructive">
              {(fileError as Error).message}
            </div>
          ) : draftIsBinary ? (
            // Editing a binary file via a text editor would round-trip its
            // bytes through TextDecoder/TextEncoder and corrupt them on
            // save. Show a clear opt-out instead of mounting an editor.
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground">
              <span className="font-medium">
                {t('components.library.skills.editor.binaryNotice.title')}
              </span>
              <span>{t('components.library.skills.editor.binaryNotice.hint')}</span>
            </div>
          ) : (
            <FilePreview
              // Remount on version flip so any internal preview state
              // (markdown TOC, source/preview toggle, xlsx mode, …) starts
              // fresh against the new bytes.
              key={`${mode}:${viewVersionForFetch ?? 'active'}:${selectedPath}`}
              filename={selectedFilename}
              content={displayContent}
              fileUrl={
                mode === 'editing'
                  ? api.draftFileUrl(sourceId, selectedPath.replace(/^\//, ''))
                  : fileUrl(skill.id, selectedPath, viewVersionForFetch)
              }
              isEditing={mode === 'editing'}
              onChange={onContentChange}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Skill description strip under the header. Collapsed to a single line by
 * default; the toggle only appears when the text actually overflows that line
 * (or is already expanded), so short descriptions stay chrome-free. Replaces
 * the old `truncate` + native `title` tooltip, which hid long descriptions
 * behind an awkward hover.
 */
function SkillDescription({ text }: { text: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  // `text` is in deps to re-measure when the description changes in place
  // (skill switch without remount); the box width stays fixed so the
  // ResizeObserver alone wouldn't catch it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on text change
  useEffect(() => {
    const el = ref.current
    // While expanded the element no longer truncates, so scrollWidth ==
    // clientWidth — skip measuring and keep the last (true) overflow value so
    // the toggle stays put.
    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, text])

  const interactive = overflows || expanded

  return (
    <div className="flex shrink-0 items-start gap-1.5 border-b border-border px-5 py-1.5 text-xs text-muted-foreground">
      <div
        ref={ref}
        className={expanded ? 'flex-1 whitespace-pre-wrap break-words' : 'flex-1 truncate'}
      >
        {text}
      </div>
      {interactive && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t(
            expanded
              ? 'components.library.skills.detail.collapseDescription'
              : 'components.library.skills.detail.expandDescription',
          )}
          className="mt-px shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  )
}
