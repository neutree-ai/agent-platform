/**
 * Tree + detail view for browsing a skill's packed contents.
 *
 * Two surfaces share this shell — the workspace authoring panel and the
 * (planned) library preview page. Everything specific to either surface is
 * pushed out through:
 *   - `source` — fs access + (optional) write actions; see SkillBrowserSource
 *   - `getSkillExtras` — wrapper-rendered decoration inside the Select picker
 *     (e.g. "*" suffix for in-edit skills)
 *   - `renderTreeHeader` — slot above the tree (publish button etc.)
 *   - `renderFileViewer` — wrapper composes the FileViewer it wants
 *   - `headerExtras` — appended into the AppWindow header slot
 *
 * Authoring-lifecycle concepts (publish, draft-create, remove) stay one
 * layer up; the shell only knows about reading and (optionally) editing
 * files within an already-selected skill.
 */
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { useInstancePersistentState, useInstanceState } from '@/stores/instance-state-store'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  type DufsEntry,
  FileEntryMenu,
  NewFileDialog,
  NewFolderDialog,
  RenameDialog,
  isDir,
} from '../file-operations'
import type { SkillBrowserSource, SkillListItem } from './types'

/**
 * Imperative escape hatch for wrappers that need to drive selection
 * synchronously alongside their own mutations (e.g. after removing a
 * skill, jumping to the next without going through a null-then-pick
 * round-trip that would empty the panel for one frame).
 *
 * Optional — leave `controllerRef` out if you don't need it.
 */
export interface SkillBrowserController {
  selectSkill(name: string | null): void
  setSelectedFile(locator: string | null): void
}

interface RenderFileViewerArgs {
  skillName: string
  /** The locator produced by `source.fileLocator(skillName, entryPath)`. */
  fileLocator: string
  onSave?: () => Promise<void> | void
  headerSlot: HTMLDivElement | null
}

interface SkillBrowserShellProps<TSkill extends SkillListItem> {
  source: SkillBrowserSource<TSkill>
  instanceId: string
  /** Persisted-state storage key for the sidebar width. Sources don't share. */
  sidebarStorageKey: string
  /** Optional skill-selector item decoration (e.g. " *" for editing skills). */
  getSkillExtras?: (skill: TSkill) => ReactNode
  /** Slot above the tree (workspace passes a publish button). */
  renderTreeHeader?: (args: { selectedSkill: TSkill | null }) => ReactNode
  /** Extra buttons appended to the AppWindow header (after the picker). */
  renderHeaderExtras?: (args: { selectedSkill: TSkill | null }) => ReactNode
  /** Wrapper renders the FileViewer it wants (workspace today, library later). */
  renderFileViewer: (args: RenderFileViewerArgs) => ReactNode
  /** i18n keys — kept here so both surfaces share the same copy. */
  emptyStateIllustration?: string
  /** Auto-pick a file when the root tree loads. Defaults to `SKILL.md`. */
  autoSelectFile?: string
  /** Optional imperative controller (see `SkillBrowserController`). */
  controllerRef?: React.MutableRefObject<SkillBrowserController | null>
}

const ROOT_DROP_TARGET = '__root__'

export function SkillBrowserShell<TSkill extends SkillListItem>({
  source,
  instanceId,
  sidebarStorageKey,
  getSkillExtras,
  renderTreeHeader,
  renderHeaderExtras,
  renderFileViewer,
  emptyStateIllustration = 'skills',
  autoSelectFile = 'SKILL.md',
  controllerRef,
}: SkillBrowserShellProps<TSkill>) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const {
    containerRef: panelRef,
    size: sidebarWidth,
    onMouseDown: handleDragSidebar,
  } = useResizablePanel({
    direction: 'left',
    min: 160,
    max: (container) => container * 0.5,
    storageKey: sidebarStorageKey,
    defaultSize: 224,
  })
  const headerSlot = useAppHeaderSlot()

  // ── persisted "where am I" state ─────────────────────────────────────────
  const [selectedSkill, setSelectedSkill] = useInstancePersistentState<string | null>(
    instanceId,
    'selectedSkill',
    () => null,
  )
  // `selectedFile` is the locator string from `source.fileLocator(...)`.
  // Treated opaque so workspace (absolute paths) and library (relative paths)
  // can both coexist via the same persistence key.
  const [selectedFile, setSelectedFile] = useInstancePersistentState<string | null>(
    instanceId,
    'selectedFile',
    () => null,
  )
  // expandedDirs are entryPath strings (skill-relative, with leading slash).
  // Sets don't survive serialization; we derive the lookup Set below.
  const [expandedDirsArr, setExpandedDirsArr] = useInstanceState<string[]>(
    instanceId,
    'expandedDirs',
    () => [],
  )
  const expandedDirs = useMemo(() => new Set(expandedDirsArr), [expandedDirsArr])

  // ── transient UI state ───────────────────────────────────────────────────
  const [fileActionsSlot, setFileActionsSlot] = useState<HTMLDivElement | null>(null)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DufsEntry | null>(null)
  const [renameParentPath, setRenameParentPath] = useState('')
  const [createParentPath, setCreateParentPath] = useState('')

  // ── DnD: single-item move within current skill's tree ────────────────────
  const dragPayloadRef = useRef<{ fromEntryPath: string; name: string; isDir: boolean } | null>(
    null,
  )
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  // ── data: skill list + dir queries ───────────────────────────────────────
  const skillsQueryKey = useMemo(
    () => [...source.cacheNamespace, 'skills'] as const,
    [source.cacheNamespace],
  )
  const skillDirQueryKey = useCallback(
    (skillName: string, subPath: string) =>
      [...source.cacheNamespace, 'dir', skillName, subPath] as const,
    [source.cacheNamespace],
  )

  const skillsQuery = useQuery<TSkill[]>({
    queryKey: skillsQueryKey,
    queryFn: () => source.fetchSkills(),
  })
  const skills = skillsQuery.data ?? []

  const rootDirQuery = useQuery<DufsEntry[]>({
    queryKey: selectedSkill
      ? skillDirQueryKey(selectedSkill, '')
      : [...source.cacheNamespace, 'dir', '__none__', ''],
    queryFn: () => source.fetchDir(selectedSkill ?? '', ''),
    enabled: !!selectedSkill,
  })
  const fileTree = rootDirQuery.data ?? []
  const fileTreeLoading = rootDirQuery.isLoading && !!selectedSkill

  const expandedDirQueries = useQueries({
    queries: selectedSkill
      ? expandedDirsArr.map((subPath) => ({
          queryKey: skillDirQueryKey(selectedSkill, subPath),
          queryFn: () => source.fetchDir(selectedSkill, subPath),
        }))
      : [],
  })
  const dirEntries = useMemo<Record<string, DufsEntry[] | undefined>>(() => {
    const out: Record<string, DufsEntry[] | undefined> = {}
    if (!selectedSkill) return out
    expandedDirsArr.forEach((subPath, i) => {
      out[subPath] = expandedDirQueries[i]?.data
    })
    return out
  }, [expandedDirsArr, expandedDirQueries, selectedSkill])

  const loadingDirs = useMemo<Set<string>>(() => {
    const out = new Set<string>()
    if (!selectedSkill) return out
    expandedDirsArr.forEach((subPath, i) => {
      const q = expandedDirQueries[i]
      if (q?.isLoading || (q && !q.data && !q.isError)) out.add(subPath)
    })
    return out
  }, [expandedDirsArr, expandedDirQueries, selectedSkill])

  const invalidateSkillDirs = useCallback(
    (skillName: string) =>
      qc.invalidateQueries({ queryKey: [...source.cacheNamespace, 'dir', skillName] }),
    [qc, source.cacheNamespace],
  )

  // ── selection management ─────────────────────────────────────────────────
  const selectSkill = useCallback(
    (name: string) => {
      setSelectedSkill(name)
      setSelectedFile(null)
      setExpandedDirsArr([])
    },
    [setSelectedSkill, setSelectedFile, setExpandedDirsArr],
  )

  const clearSelection = useCallback(() => {
    setSelectedSkill(null)
    setSelectedFile(null)
    setExpandedDirsArr([])
  }, [setSelectedSkill, setSelectedFile, setExpandedDirsArr])

  // Selection lifecycle vs skill list:
  //   - nothing selected → pick first
  //   - selected skill no longer in list (deletion / visibility change)
  //     → roll to the next remaining one synchronously, or clear if the
  //       list emptied
  // Combined into one effect so the two cases share the latest `skills`
  // snapshot and don't race each other.
  useEffect(() => {
    if (skillsQuery.isLoading) return
    if (selectedSkill) {
      const stillThere = skills.some((s) => s.name === selectedSkill)
      if (!stillThere) {
        if (skills.length > 0) selectSkill(skills[0].name)
        else clearSelection()
      }
    } else if (skills.length > 0) {
      selectSkill(skills[0].name)
    }
  }, [skillsQuery.isLoading, skills, selectedSkill, selectSkill, clearSelection])

  // Wire up the imperative controller (if the wrapper opted in).
  useEffect(() => {
    if (!controllerRef) return
    controllerRef.current = {
      selectSkill: (name) => (name === null ? clearSelection() : selectSkill(name)),
      setSelectedFile,
    }
    return () => {
      if (controllerRef.current) controllerRef.current = null
    }
  }, [controllerRef, selectSkill, clearSelection, setSelectedFile])

  // Auto-open the headline file (`SKILL.md` by default) on first tree load.
  const lastAutoSelectedSkillRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedSkill || selectedFile) return
    if (lastAutoSelectedSkillRef.current === selectedSkill) return
    if (rootDirQuery.isSuccess && fileTree.some((e) => e.name === autoSelectFile)) {
      lastAutoSelectedSkillRef.current = selectedSkill
      setSelectedFile(source.fileLocator(selectedSkill, `/${autoSelectFile}`))
    }
  }, [
    selectedSkill,
    selectedFile,
    rootDirQuery.isSuccess,
    fileTree,
    autoSelectFile,
    source,
    setSelectedFile,
  ])

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirsArr((prev) => {
        const set = new Set(prev)
        if (set.has(dirPath)) set.delete(dirPath)
        else set.add(dirPath)
        return Array.from(set)
      })
    },
    [setExpandedDirsArr],
  )

  // ── write mutations (only mounted when source.writes is present) ─────────
  const writes = source.writes
  const canManageFiles = !!writes

  const afterMutate = useCallback(
    async (skillName: string) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: skillsQueryKey }),
        invalidateSkillDirs(skillName),
        writes?.onAfterMutate?.(skillName),
      ])
    },
    [qc, skillsQueryKey, invalidateSkillDirs, writes],
  )

  const newFileMutation = useMutation({
    mutationFn: async ({ name, parentPath }: { name: string; parentPath: string }) => {
      if (!selectedSkill || !writes) throw new Error('No skill selected')
      const { entryPath } = await writes.createFile(selectedSkill, parentPath, name)
      return { entryPath, name }
    },
    onSuccess: async ({ entryPath, name }) => {
      if (!selectedSkill) return
      await afterMutate(selectedSkill)
      setSelectedFile(source.fileLocator(selectedSkill, entryPath))
      setNewFileOpen(false)
      toast.success(t('components.workspaceSkillsPanel.toasts.createdFile', { name }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const handleNewFile = useCallback(
    (name: string) => newFileMutation.mutate({ name, parentPath: createParentPath }),
    [newFileMutation, createParentPath],
  )

  const deleteFileMutation = useMutation({
    mutationFn: async ({
      entryPath,
      fileName,
      isDirEntry,
    }: { entryPath: string; fileName: string; isDirEntry: boolean }) => {
      if (!selectedSkill || !writes) throw new Error('No skill selected')
      await writes.deleteEntry(selectedSkill, entryPath, isDirEntry)
      return { entryPath, fileName }
    },
    onSuccess: async ({ entryPath, fileName }) => {
      if (!selectedSkill) return
      await afterMutate(selectedSkill)
      const removedLocator = source.fileLocator(selectedSkill, entryPath)
      if (selectedFile === removedLocator) setSelectedFile(null)
      toast.success(t('components.workspaceSkillsPanel.toasts.deletedFile', { name: fileName }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteEntry = useCallback(
    (entryPath: string, fileName: string, isDirEntry: boolean) =>
      deleteFileMutation.mutate({ entryPath, fileName, isDirEntry }),
    [deleteFileMutation],
  )

  const newFolderMutation = useMutation({
    mutationFn: async ({ name, parentPath }: { name: string; parentPath: string }) => {
      if (!selectedSkill || !writes) throw new Error('No skill selected')
      await writes.mkdir(selectedSkill, parentPath, name)
      return { name }
    },
    onSuccess: async ({ name }) => {
      if (!selectedSkill) return
      await afterMutate(selectedSkill)
      setMkdirOpen(false)
      toast.success(t('components.workspaceSkillsPanel.toasts.createdFolder', { name }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const handleNewFolder = useCallback(
    (name: string) => newFolderMutation.mutate({ name, parentPath: createParentPath }),
    [newFolderMutation, createParentPath],
  )

  const renameMutation = useMutation({
    mutationFn: async ({
      target,
      parentPath,
      newName: nextName,
    }: { target: DufsEntry; parentPath: string; newName: string }) => {
      if (!selectedSkill || !writes) throw new Error('No skill selected')
      const fromEntry = `${parentPath}/${target.name}`
      const toEntry = `${parentPath}/${nextName}`
      await writes.move(selectedSkill, fromEntry, toEntry)
      return { fromEntry, toEntry, nextName }
    },
    onSuccess: async ({ fromEntry, toEntry, nextName }) => {
      if (!selectedSkill) return
      await afterMutate(selectedSkill)
      const oldLocator = source.fileLocator(selectedSkill, fromEntry)
      const newLocator = source.fileLocator(selectedSkill, toEntry)
      if (selectedFile === oldLocator) setSelectedFile(newLocator)
      setRenameOpen(false)
      toast.success(t('components.workspaceSkillsPanel.toasts.renamed', { name: nextName }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const handleRename = useCallback(
    (nextName: string) => {
      if (!renameTarget) return
      renameMutation.mutate({
        target: renameTarget,
        parentPath: renameParentPath,
        newName: nextName,
      })
    },
    [renameMutation, renameTarget, renameParentPath],
  )

  // DnD: relocate a single entry within the current skill's tree.
  const dndMoveMutation = useMutation({
    mutationFn: async ({
      fromEntryPath,
      toEntryPath,
    }: { fromEntryPath: string; toEntryPath: string; name: string }) => {
      if (!selectedSkill || !writes) throw new Error('No skill selected')
      await writes.move(selectedSkill, fromEntryPath, toEntryPath)
      return { fromEntryPath, toEntryPath }
    },
    onSuccess: async ({ fromEntryPath, toEntryPath }) => {
      if (!selectedSkill) return
      await afterMutate(selectedSkill)
      const oldLocator = source.fileLocator(selectedSkill, fromEntryPath)
      const newLocator = source.fileLocator(selectedSkill, toEntryPath)
      if (selectedFile === oldLocator) setSelectedFile(newLocator)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const handleRowDragStart = useCallback(
    (e: React.DragEvent, entryPath: string, name: string, isDirEntry: boolean) => {
      if (!canManageFiles || !selectedSkill) {
        e.preventDefault()
        return
      }
      dragPayloadRef.current = { fromEntryPath: entryPath, name, isDir: isDirEntry }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('application/x-nap-files-move', '1')
    },
    [canManageFiles, selectedSkill],
  )

  const handleDragEnd = useCallback(() => {
    dragPayloadRef.current = null
    setDropTargetPath(null)
  }, [])

  // Drop validity:
  //  - reject self
  //  - reject dropping a folder into its own descendant
  //  - reject dropping into the entry's current parent (no-op move)
  const isInvalidDrop = useCallback(
    (payload: { fromEntryPath: string; name: string; isDir: boolean }, targetEntry: string) => {
      if (payload.fromEntryPath === targetEntry) return true
      if (payload.isDir && targetEntry.startsWith(`${payload.fromEntryPath}/`)) return true
      const fromParent = payload.fromEntryPath.substring(0, payload.fromEntryPath.lastIndexOf('/'))
      // empty parent = root; targetEntry "" represents root
      if (fromParent === targetEntry) return true
      return false
    },
    [],
  )

  const handleFolderDragOver = useCallback(
    (e: React.DragEvent, entryPath: string) => {
      const payload = dragPayloadRef.current
      if (!payload || !selectedSkill) return
      if (isInvalidDrop(payload, entryPath)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetPath(entryPath)
    },
    [selectedSkill, isInvalidDrop],
  )

  const handleFolderDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>, entryPath: string) => {
      const next = e.relatedTarget as Node | null
      if (next && e.currentTarget.contains(next)) return
      setDropTargetPath((prev) => (prev === entryPath ? null : prev))
    },
    [],
  )

  const handleFolderDrop = useCallback(
    (e: React.DragEvent, entryPath: string) => {
      e.preventDefault()
      e.stopPropagation()
      const payload = dragPayloadRef.current
      setDropTargetPath(null)
      dragPayloadRef.current = null
      if (!payload || !selectedSkill) return
      if (isInvalidDrop(payload, entryPath)) return
      dndMoveMutation.mutate({
        fromEntryPath: payload.fromEntryPath,
        toEntryPath: `${entryPath}/${payload.name}`,
        name: payload.name,
      })
    },
    [selectedSkill, isInvalidDrop, dndMoveMutation],
  )

  // Root drop: relocate to skill root. Valid only when entry isn't already there.
  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      const payload = dragPayloadRef.current
      if (!payload || !selectedSkill) return
      const fromParent = payload.fromEntryPath.substring(0, payload.fromEntryPath.lastIndexOf('/'))
      if (fromParent === '') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetPath(ROOT_DROP_TARGET)
    },
    [selectedSkill],
  )

  const handleRootDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setDropTargetPath((prev) => (prev === ROOT_DROP_TARGET ? null : prev))
  }, [])

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const payload = dragPayloadRef.current
      setDropTargetPath(null)
      dragPayloadRef.current = null
      if (!payload || !selectedSkill) return
      const fromParent = payload.fromEntryPath.substring(0, payload.fromEntryPath.lastIndexOf('/'))
      if (fromParent === '') return
      dndMoveMutation.mutate({
        fromEntryPath: payload.fromEntryPath,
        toEntryPath: `/${payload.name}`,
        name: payload.name,
      })
    },
    [selectedSkill, dndMoveMutation],
  )

  // ── tree rendering ───────────────────────────────────────────────────────
  const renderEntries = (entries: DufsEntry[], skillName: string, parentPath = '') => {
    const sorted = [...entries].sort((a, b) => {
      if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return sorted.map((entry) => {
      const entryPath = `${parentPath}/${entry.name}`
      if (isDir(entry)) {
        const expanded = expandedDirs.has(entryPath)
        const isDropTarget = dropTargetPath === entryPath
        const FolderIcon = expanded ? FolderOpen : Folder
        const dirLoading = expanded && loadingDirs.has(entryPath)
        return (
          <div
            key={entryPath}
            className="group"
            onDragOver={(e) => handleFolderDragOver(e, entryPath)}
            onDragLeave={(e) => handleFolderDragLeave(e, entryPath)}
            onDrop={(e) => handleFolderDrop(e, entryPath)}
          >
            <div className="flex items-center">
              {/* biome-ignore lint/a11y/useSemanticElements: <button draggable> is unreliable across browsers — same pattern as files panel */}
              <div
                role="button"
                tabIndex={0}
                draggable={canManageFiles}
                onDragStart={(e) => handleRowDragStart(e, entryPath, entry.name, true)}
                onDragEnd={handleDragEnd}
                onClick={() => toggleDir(entryPath)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleDir(entryPath)
                  }
                }}
                className={`flex min-w-0 flex-1 cursor-default select-none items-center gap-1.5 rounded px-2 py-1 text-xs ${
                  isDropTarget
                    ? 'bg-foreground/[0.08] ring-1 ring-foreground/[0.14]'
                    : 'hover:bg-foreground/[0.04]'
                }`}
              >
                {dirLoading ? (
                  <Spinner className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                  />
                )}
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{entry.name}</span>
              </div>
              {canManageFiles && (
                <FileEntryMenu
                  entry={entry}
                  onNewFile={() => {
                    setCreateParentPath(entryPath)
                    setNewFileOpen(true)
                  }}
                  onNewFolder={() => {
                    setCreateParentPath(entryPath)
                    setMkdirOpen(true)
                  }}
                  onRename={() => {
                    setRenameTarget(entry)
                    setRenameParentPath(parentPath)
                    setRenameOpen(true)
                  }}
                  onDelete={() => deleteEntry(entryPath, entry.name, true)}
                />
              )}
            </div>
            {expanded && !dirLoading && dirEntries[entryPath] && (
              <div className="ml-3 border-l border-foreground/[0.08] pl-1">
                {renderEntries(dirEntries[entryPath] ?? [], skillName, entryPath)}
              </div>
            )}
          </div>
        )
      }
      const fileLocator = source.fileLocator(skillName, entryPath)
      return (
        <div key={entryPath} className="group flex items-center">
          {/* biome-ignore lint/a11y/useSemanticElements: <button draggable> is unreliable; same pattern as folder row */}
          <div
            role="button"
            tabIndex={0}
            draggable={canManageFiles}
            onDragStart={(e) => handleRowDragStart(e, entryPath, entry.name, false)}
            onDragEnd={handleDragEnd}
            onClick={() => setSelectedFile(fileLocator)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelectedFile(fileLocator)
              }
            }}
            className={`flex min-w-0 flex-1 cursor-default select-none items-center gap-1.5 rounded px-2 py-1 text-xs ${selectedFile === fileLocator ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.04]'}`}
          >
            <span className="w-3" />
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.name}</span>
          </div>
          {canManageFiles && (
            <FileEntryMenu
              entry={entry}
              onRename={() => {
                setRenameTarget(entry)
                setRenameParentPath(parentPath)
                setRenameOpen(true)
              }}
              onDelete={() => deleteEntry(entryPath, entry.name, false)}
            />
          )}
        </div>
      )
    })
  }

  // ── render ───────────────────────────────────────────────────────────────
  if (skillsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" /> {t('components.workspaceSkillsPanel.loading')}
      </div>
    )
  }

  const currentSkill: TSkill | null = skills.find((s) => s.name === selectedSkill) ?? null

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <Select value={selectedSkill ?? ''} onValueChange={(v) => selectSkill(v)}>
              <SelectTrigger className="h-7 min-w-[180px] max-w-[280px] border-transparent bg-foreground/[0.04] px-2 text-xs hover:bg-foreground/[0.07] data-[state=open]:bg-foreground/[0.09] focus:ring-0 focus:ring-offset-0 shadow-none [&>span]:truncate">
                <SelectValue
                  placeholder={t('components.workspaceSkillsPanel.placeholders.selectSkill')}
                />
              </SelectTrigger>
              <SelectContent>
                {skills.map((skill) => (
                  <SelectItem key={skill.name} value={skill.name} className="text-xs">
                    {skill.name}
                    {getSkillExtras?.(skill)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {renderHeaderExtras?.({ selectedSkill: currentSkill })}
            {selectedFile && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.1]" />
                <div ref={setFileActionsSlot} className="flex shrink-0 items-center gap-0.5" />
              </>
            )}
          </>,
          headerSlot,
        )}
      <div ref={panelRef} className="flex h-full">
        <div
          className="flex shrink-0 flex-col border-r border-border"
          style={{ width: sidebarWidth }}
        >
          {renderTreeHeader?.({ selectedSkill: currentSkill })}

          {/* File tree — outer div is the skill-root drop zone for DnD move. */}
          <ScrollArea className="flex-1">
            <div
              className={`p-1 ${
                dropTargetPath === ROOT_DROP_TARGET
                  ? 'rounded ring-1 ring-inset ring-foreground/[0.14] bg-foreground/[0.04]'
                  : ''
              }`}
              onDragOver={handleRootDragOver}
              onDragLeave={handleRootDragLeave}
              onDrop={handleRootDrop}
            >
              {!selectedSkill ? (
                skills.length === 0 ? (
                  <EmptyHero
                    className="py-6"
                    illustration={<EmptyIllustration src={emptyStateIllustration} size="h-20" />}
                    title={t('components.workspaceSkillsPanel.empty.noSkills.title')}
                    description={t('components.workspaceSkillsPanel.empty.noSkills.description')}
                  />
                ) : (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {t('components.workspaceSkillsPanel.empty.selectSkill')}
                  </div>
                )
              ) : fileTreeLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : (
                <>
                  {fileTree.length === 0 && (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {t('components.workspaceSkillsPanel.empty.empty')}
                    </div>
                  )}
                  {fileTree.length > 0 && renderEntries(fileTree, selectedSkill)}
                  {canManageFiles && (
                    <div className="mt-1 flex gap-1 px-2">
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-1.5 rounded py-1 px-1 text-xs text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                        onClick={() => {
                          setCreateParentPath('')
                          setNewFileOpen(true)
                        }}
                      >
                        <FilePlus className="h-3.5 w-3.5 shrink-0" />
                        <span>{t('components.fileOperations.actions.newFile')}</span>
                      </button>
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-1.5 rounded py-1 px-1 text-xs text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                        onClick={() => {
                          setCreateParentPath('')
                          setMkdirOpen(true)
                        }}
                      >
                        <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                        <span>{t('components.fileOperations.actions.newFolder')}</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Drag handle */}
        <div
          className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-border/40"
          onMouseDown={handleDragSidebar}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60" />
        </div>

        {/* Right: file viewer (wrapper-provided) */}
        <div className="flex flex-1 flex-col min-w-0">
          {selectedFile && selectedSkill ? (
            renderFileViewer({
              skillName: selectedSkill,
              fileLocator: selectedFile,
              onSave: writes
                ? async () => {
                    // workspace's editing flag may flip after a save;
                    // refresh the skill list so the picker's "*" suffix updates.
                    await afterMutate(selectedSkill)
                  }
                : undefined,
              headerSlot: fileActionsSlot,
            })
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t('components.workspaceSkillsPanel.empty.selectFile')}
            </div>
          )}
        </div>

        {/* File operation dialogs — only when writes are available */}
        {canManageFiles && (
          <>
            <NewFileDialog
              open={newFileOpen}
              onOpenChange={setNewFileOpen}
              onSubmit={handleNewFile}
            />
            <NewFolderDialog
              open={mkdirOpen}
              onOpenChange={setMkdirOpen}
              onSubmit={handleNewFolder}
            />
            <RenameDialog
              open={renameOpen}
              onOpenChange={setRenameOpen}
              currentName={renameTarget?.name ?? ''}
              onRename={handleRename}
            />
          </>
        )}
      </div>
    </>
  )
}
