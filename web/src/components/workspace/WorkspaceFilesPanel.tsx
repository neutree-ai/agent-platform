import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRequiredSlotContext } from '@/contexts/SlotContext'
import {
  type AfsShareSummary,
  type DriveKind,
  createFileExportUrl,
  dirListUrl,
  dirZipUrl,
  fileUrl,
  listAfsShares,
  listFileExportTokens,
  mkdir,
  move,
  revokeFileExportToken,
} from '@/lib/api/agent-files'
import { formatFullTime, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { filesRefresh } from '@/plugins/files'
import { useComposerStore } from '@/stores/composer-store'
import { useInstancePersistentState, useInstanceState } from '@/stores/instance-state-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Download,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FileViewer } from './FileViewer'
import { AfsSharesPanel } from './afs/AfsSharesPanel'
import {
  type DufsEntry,
  FileEntryMenu,
  ManagePublicLinksDialog,
  NewFileDialog,
  NewFolderDialog,
  PublicLinkDialog,
  RenameDialog,
  isDir,
} from './file-operations'
import { isImageFile } from './file-preview/file-types'
import { useFileAnchor } from './file-preview/useFileAnchor'

interface UploadProgress {
  fileName: string
  loaded: number
  total: number
}

interface WorkspaceFilesPanelProps {
  workspaceId: string
  instanceId: string
  /**
   * When set, lock the panel to a single drive and hide the Local/Cloud
   * switcher. Used by embedded hosts (e.g. teamwork's shared-folder panel)
   * that only ever care about one side.
   */
  lockedDrive?: DriveKind
  /**
   * Re-base navigation and breadcrumbs to a subdirectory. The breadcrumb
   * hides every segment above this path, and `navigate()` clamps any
   * attempt to step out back to this root. Path must end with '/'.
   * Used by embedded hosts (e.g. teamwork) so the user only sees the
   * directory they're scoped to, not the full AFS root.
   */
  rootPath?: string
  /**
   * Label for the first breadcrumb crumb when `rootPath` is set. Defaults
   * to the last segment of `rootPath`. Ignored when `rootPath` is unset.
   */
  rootLabel?: string
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

// FileViewer is now imported from ./FileViewer

export function WorkspaceFilesPanel({
  workspaceId,
  instanceId,
  lockedDrive,
  rootPath,
  rootLabel,
}: WorkspaceFilesPanelProps) {
  // Normalize root to a trailing-slash dir path. '/' (default) means "no
  // re-basing" — breadcrumbs start from the drive root as before.
  const normalizedRoot = rootPath ? (rootPath.endsWith('/') ? rootPath : `${rootPath}/`) : '/'
  const rootSegments = normalizedRoot === '/' ? 0 : normalizedRoot.split('/').filter(Boolean).length
  const { t, i18n } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const requestComposerInsert = useComposerStore((s) => s.requestInsert)

  // Persisted view (survives refresh / cross-device). When `lockedDrive` is
  // set the persisted value is ignored — the host has decided which drive
  // this embedded instance shows.
  const [persistedDrive, setDrive] = useInstancePersistentState<DriveKind>(
    instanceId,
    'drive',
    () => 'workspace',
  )
  const drive: DriveKind = lockedDrive ?? persistedDrive
  // Single canonical "where am I looking" — directory ends with '/', file
  // doesn't. currentPath / isViewingFile are derived below.
  const [viewingPath, setViewingPath] = useInstancePersistentState<string>(
    instanceId,
    'viewingPath',
    () => '/',
  )
  const { viewingLine, viewingColumn, clearAnchor } = useFileAnchor(instanceId)
  const [sortBy, setSortBy] = useInstancePersistentState<'name' | 'mtime' | 'size'>(
    instanceId,
    'sortBy',
    () => 'name',
  )
  const [sortDir, setSortDir] = useInstancePersistentState<'asc' | 'desc'>(
    instanceId,
    'sortDir',
    () => 'asc',
  )

  // In-memory instance state — survives layout switch but not refresh.
  const [searchQuery, setSearchQuery] = useInstanceState<string>(
    instanceId,
    'searchQuery',
    () => '',
  )
  const [isSearching, setIsSearching] = useInstanceState<boolean>(
    instanceId,
    'isSearching',
    () => false,
  )

  // Component-local — purely render-cycle state.
  const [afsRefreshToken, setAfsRefreshToken] = useState(0)
  const [fileRefreshToken, setFileRefreshToken] = useState(0)
  const [pathCopied, setPathCopied] = useState(false)

  const handleCopyPath = useCallback(() => {
    const fullPath = `${drive === 'workspace' ? '/workspace' : '/mnt/afs'}${viewingPath}`
    navigator.clipboard.writeText(fullPath).then(() => {
      setPathCopied(true)
      setTimeout(() => setPathCopied(false), 1500)
    })
  }, [drive, viewingPath])

  const isViewingFile = viewingPath !== '' && !viewingPath.endsWith('/')
  const currentPath = isViewingFile
    ? viewingPath.substring(0, viewingPath.lastIndexOf('/') + 1) || '/'
    : viewingPath || '/'

  const qc = useQueryClient()
  const listingQueryKey = useMemo(
    () => ['workspace-files', workspaceId, drive, currentPath, searchQuery || ''] as const,
    [workspaceId, drive, currentPath, searchQuery],
  )
  const isAfsRoot = drive === 'afs' && currentPath === '/'
  const listingQuery = useQuery<{ entries: DufsEntry[] }>({
    queryKey: listingQueryKey,
    queryFn: async () => {
      const resp = await fetch(
        dirListUrl(workspaceId, currentPath, searchQuery || undefined, drive),
      )
      if (!resp.ok) {
        throw new Error(t('components.workspaceFiles.errors.listFailed', { status: resp.status }))
      }
      return resp.json()
    },
    enabled: !isAfsRoot,
  })
  const entries: DufsEntry[] = listingQuery.data?.entries ?? []
  const isLoading = listingQuery.isLoading && !isAfsRoot
  const listingError = listingQuery.error
    ? listingQuery.error instanceof Error
      ? listingQuery.error.message
      : String(listingQuery.error)
    : null

  // Mutations write through the listing query. After success, invalidate so
  // the directory we just changed is re-fetched. We also bump child tokens
  // (FileViewer / AfsSharesPanel) so they pick up out-of-band changes too.
  const invalidateListing = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['workspace-files', workspaceId] })
    setAfsRefreshToken((n) => n + 1)
    setFileRefreshToken((n) => n + 1)
  }, [qc, workspaceId])

  // AFS share permission map (name → permission). Fetched when drive === 'afs'.
  const [afsShares, setAfsShares] = useState<AfsShareSummary[]>([])
  const afsPermissionByName = useMemo(() => {
    const m = new Map<string, 'read_only' | 'read_write'>()
    for (const s of afsShares) m.set(s.name, s.my_permission)
    return m
  }, [afsShares])

  // On the afs drive, the first path segment identifies the share. Writes are
  // never allowed at the afs root (user can't create bare folders under
  // /mnt/afs — those are mount points managed by the platform). Writes inside
  // a share depend on that share's permission.
  const writeAllowed = useMemo(() => {
    if (drive === 'workspace') return true
    const trimmed = currentPath.replace(/^\/+|\/+$/g, '')
    if (trimmed === '') return false // at afs root
    const firstSeg = trimmed.split('/')[0]
    return afsPermissionByName.get(firstSeg) === 'read_write'
  }, [drive, currentPath, afsPermissionByName])

  const sortedEntries = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1
    const copy = [...entries]
    copy.sort((a, b) => {
      // Directories always first, regardless of sort mode.
      if (isDir(a) && !isDir(b)) return -1
      if (!isDir(a) && isDir(b)) return 1
      let cmp = 0
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortBy === 'mtime') {
        cmp = (a.mtime ?? 0) - (b.mtime ?? 0)
        if (cmp === 0) cmp = a.name.localeCompare(b.name)
      } else {
        // size — dirs have no meaningful size, fall back to name within the dir group.
        if (isDir(a) && isDir(b)) {
          cmp = a.name.localeCompare(b.name)
        } else {
          cmp = (a.size ?? 0) - (b.size ?? 0)
          if (cmp === 0) cmp = a.name.localeCompare(b.name)
        }
      }
      return cmp * dirMul
    })
    return copy
  }, [entries, sortBy, sortDir])

  // Image sibling navigation. When viewing an image file, expose handlers to
  // step through other images in the same directory (display order, no wrap).
  const imageNav = useMemo(() => {
    if (!isViewingFile) return { prev: null as string | null, next: null as string | null }
    const leaf = viewingPath.split('/').pop() || ''
    if (!isImageFile(leaf)) return { prev: null, next: null }
    const images = sortedEntries.filter((e) => !isDir(e) && isImageFile(e.name))
    const idx = images.findIndex((e) => e.name === leaf)
    if (idx < 0) return { prev: null, next: null }
    const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`
    return {
      prev: idx > 0 ? `${dir}${images[idx - 1].name}` : null,
      next: idx < images.length - 1 ? `${dir}${images[idx + 1].name}` : null,
    }
  }, [isViewingFile, viewingPath, sortedEntries, currentPath])

  const goToPrevImage = useMemo(
    () => (imageNav.prev ? () => setViewingPath(imageNav.prev as string) : null),
    [imageNav.prev, setViewingPath],
  )
  const goToNextImage = useMemo(
    () => (imageNav.next ? () => setViewingPath(imageNav.next as string) : null),
    [imageNav.next, setViewingPath],
  )

  // ArrowLeft / ArrowRight while previewing an image step through siblings.
  // Skips when the user is typing in an input/textarea/contenteditable host.
  useEffect(() => {
    if (!goToPrevImage && !goToNextImage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (el.isContentEditable) return
      }
      if (e.key === 'ArrowLeft' && goToPrevImage) {
        e.preventDefault()
        goToPrevImage()
      } else if (e.key === 'ArrowRight' && goToNextImage) {
        e.preventDefault()
        goToNextImage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToPrevImage, goToNextImage])

  const handleSortClick = (col: 'name' | 'mtime' | 'size') => {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir(col === 'name' ? 'asc' : 'desc')
    }
  }

  const SortIndicator = ({ col }: { col: 'name' | 'mtime' | 'size' }) => {
    if (sortBy !== col) return null
    const Icon = sortDir === 'asc' ? ChevronUp : ChevronDown
    return <Icon className="ml-0.5 h-3 w-3 shrink-0 text-foreground/70" />
  }

  const slotCtx = useRequiredSlotContext()

  // Dialog states
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileParent, setNewFileParent] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DufsEntry | null>(null)
  const [publicLinkOpen, setPublicLinkOpen] = useState(false)
  const [publicLinkTarget, setPublicLinkTarget] = useState<DufsEntry | null>(null)
  const [managePublicLinksOpen, setManagePublicLinksOpen] = useState(false)

  // Upload state
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map())
  const uploading = uploads.size > 0
  const overallProgress = useMemo(() => {
    if (uploads.size === 0) return 0
    let loaded = 0
    let total = 0
    for (const u of uploads.values()) {
      loaded += u.loaded
      total += u.total
    }
    return total === 0 ? 0 : Math.round((loaded / total) * 100)
  }, [uploads])

  // Selection state — names within currentPath. Cleared on navigate / drive change.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const lastAnchorRef = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearing on path/drive change is intentional
  useEffect(() => {
    setSelected(new Set())
    lastAnchorRef.current = null
  }, [currentPath, drive])

  // Slot for the FileViewer to portal its action buttons into when in
  // viewing-file mode. State (not ref) so the portal re-renders once the DOM
  // node mounts.
  const [fileActionsSlot, setFileActionsSlot] = useState<HTMLDivElement | null>(null)

  // Drag state — split by source: external (OS files → upload) vs internal
  // (intra-app row drag → move). Container DnD only reacts to external.
  const [isExternalDragging, setIsExternalDragging] = useState(false)
  const externalDragCounter = useRef(0)
  // Folder name (within currentPath) or breadcrumb path being hovered for an
  // internal-move drop. Empty string means "current dir" (no-op target).
  const [internalDropTarget, setInternalDropTarget] = useState<string | null>(null)
  // Proactive drop-affordance: true while an internal drag is in flight, used
  // to softly hint valid drop targets (e.g. breadcrumb pills) before hover.
  const [isInternalDragActive, setIsInternalDragActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load share permission map when switching to the afs drive.
  useEffect(() => {
    if (drive !== 'afs') return
    let cancelled = false
    listAfsShares(workspaceId)
      .then((shares) => {
        if (!cancelled) setAfsShares(shares)
      })
      .catch(() => {
        // Non-fatal; default to read-only (writeAllowed stays false for unknown shares).
      })
    return () => {
      cancelled = true
    }
  }, [drive, workspaceId])

  // Agent-driven auto-refresh: files plugin bumps when a file- or
  // share-mutating tool completes. Invalidate the listing query so it
  // re-fetches; bump child tokens so FileViewer / AfsSharesPanel re-fetch
  // their own data.
  const agentFilesToken = filesRefresh.useToken()
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on agentFilesToken change
  useEffect(() => {
    if (agentFilesToken === 0) return
    invalidateListing()
  }, [agentFilesToken])

  const navigate = (path: string) => {
    // Always trailing-slash for directories — viewingPath convention.
    const dirPath = path.endsWith('/') ? path : `${path}/`
    // When the host has fenced us with `rootPath`, refuse to step above it
    // — snap back to the fence instead of leaking into the parent drive.
    const target =
      normalizedRoot !== '/' && !dirPath.startsWith(normalizedRoot) ? normalizedRoot : dirPath
    setViewingPath(target)
    clearAnchor()
    setSearchQuery('')
    setIsSearching(false)
  }

  const refresh = () => {
    // At afs root we render AfsSharesPanel (which has its own fetch) — bump
    // a token so it re-fetches. The listing query is disabled at afs root,
    // so invalidating it there is a no-op aside from clearing cached data.
    invalidateListing()
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    // Listing query is keyed on searchQuery, so it refetches automatically.
  }

  const openFile = (entry: DufsEntry) => {
    const filePath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
    setViewingPath(filePath)
    clearAnchor()
    // Exit search mode when entering file view — search has no meaning over
    // a single preview, and the header breadcrumb area is reused.
    if (isSearching) {
      setIsSearching(false)
      setSearchQuery('')
    }
  }

  const closeFile = () => {
    setViewingPath(currentPath)
    clearAnchor()
  }

  const uploadFile = useCallback(
    (file: File, destDir: string, relativePath?: string): Promise<void> => {
      const dir = destDir.endsWith('/') ? destDir : `${destDir}/`
      const subPath = relativePath ?? file.name
      const path = `${dir}${subPath.replace(/^\/+/, '')}`
      const displayName = relativePath ?? file.name
      const key = `${Date.now()}-${path}-${Math.random().toString(36).slice(2, 8)}`
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploads((prev) => {
              const next = new Map(prev)
              next.set(key, {
                fileName: displayName,
                loaded: e.loaded,
                total: e.total,
              })
              return next
            })
          }
        }
        xhr.onload = () => {
          setUploads((prev) => {
            const next = new Map(prev)
            next.delete(key)
            return next
          })
          resolve()
        }
        xhr.onerror = () => {
          setUploads((prev) => {
            const next = new Map(prev)
            next.delete(key)
            return next
          })
          reject(new Error(`Upload failed: ${displayName}`))
        }
        // Initialize progress entry
        setUploads((prev) => {
          const next = new Map(prev)
          next.set(key, { fileName: displayName, loaded: 0, total: file.size })
          return next
        })
        xhr.open('PUT', fileUrl(workspaceId, path, drive))
        xhr.send(file)
      })
    },
    [workspaceId, drive],
  )

  // Drained reader: directoryReader.readEntries returns at most ~100 entries
  // per call and signals completion with an empty batch — must loop.
  const readAllEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = []
      const pump = () => {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(all)
            return
          }
          all.push(...batch)
          pump()
        }, reject)
      }
      pump()
    })

  const entryToFile = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => {
      entry.file(resolve, reject)
    })

  const collectFromEntry = async (
    entry: FileSystemEntry,
    prefix: string,
  ): Promise<Array<{ file: File; relativePath: string }>> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await entryToFile(fileEntry)
      return [{ file, relativePath: prefix + file.name }]
    }
    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const reader = dirEntry.createReader()
      const children = await readAllEntries(reader)
      const nested = await Promise.all(
        children.map((c) => collectFromEntry(c, `${prefix}${entry.name}/`)),
      )
      return nested.flat()
    }
    return []
  }

  const traverseDataTransferItems = async (
    items: DataTransferItemList,
  ): Promise<Array<{ file: File; relativePath: string }>> => {
    // webkitGetAsEntry must run synchronously inside the drop handler — call
    // it eagerly, then resolve directories asynchronously off the captured
    // entries.
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry()
      if (entry) entries.push(entry)
    }
    const collected = await Promise.all(entries.map((e) => collectFromEntry(e, '')))
    return collected.flat()
  }

  const uploadDataTransfer = useCallback(
    async (dataTransfer: DataTransfer, destDir: string) => {
      const items = dataTransfer.items
      if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
        const collected = await traverseDataTransferItems(items)
        if (collected.length === 0) {
          // Fallback: items existed but yielded no entries (rare).
          await Promise.all(Array.from(dataTransfer.files).map((f) => uploadFile(f, destDir)))
        } else {
          await Promise.all(
            collected.map(({ file, relativePath }) => uploadFile(file, destDir, relativePath)),
          )
        }
      } else {
        await Promise.all(Array.from(dataTransfer.files).map((f) => uploadFile(f, destDir)))
      }
      invalidateListing()
    },
    [uploadFile, invalidateListing],
  )

  const handleUpload = async (files: FileList, destDir: string = currentPath) => {
    // XHR upload keeps streaming progress out of useMutation; just invalidate
    // once everything settles.
    await Promise.all(Array.from(files).map((f) => uploadFile(f, destDir)))
    invalidateListing()
  }

  const mkdirMutation = useMutation({
    mutationFn: (name: string) => {
      const path = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${name}`
      return mkdir(workspaceId, path, drive)
    },
    onSuccess: () => {
      setMkdirOpen(false)
      invalidateListing()
    },
  })

  const newFileMutation = useMutation({
    mutationFn: async ({ parentDir, name }: { parentDir: string; name: string }) => {
      const dir = parentDir.endsWith('/') ? parentDir : `${parentDir}/`
      const path = `${dir}${name}`
      const resp = await fetch(fileUrl(workspaceId, path, drive), {
        method: 'PUT',
        credentials: 'include',
        body: '',
      })
      if (!resp.ok)
        throw new Error(
          t('components.workspaceFiles.errors.createFileFailed', { status: resp.status }),
        )
    },
    onSuccess: () => {
      setNewFileOpen(false)
      setNewFileParent(null)
      invalidateListing()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (entry: DufsEntry) => {
      const path = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
      await fetch(fileUrl(workspaceId, path, drive), { method: 'DELETE' })
    },
    onSuccess: () => {
      invalidateListing()
    },
  })

  const renameMutation = useMutation({
    mutationFn: async ({ entry, newName }: { entry: DufsEntry; newName: string }) => {
      const oldPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
      const newPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${newName}`
      await move(workspaceId, oldPath, newPath, drive)
    },
    onSuccess: () => {
      setRenameOpen(false)
      setRenameTarget(null)
      invalidateListing()
    },
  })

  const handleMkdir = (name: string) => mkdirMutation.mutate(name)
  const handleNewFile = (parentDir: string, name: string) =>
    newFileMutation.mutate({ parentDir, name })
  const handleDelete = (entry: DufsEntry) => deleteMutation.mutate(entry)
  const handleRename = (newName: string) => {
    if (!renameTarget) return
    renameMutation.mutate({ entry: renameTarget, newName })
  }

  // Mint a short-lived public URL for a workspace file. Workspace drive
  // only — public-exports forwards to the workspace dufs, not the AFS one.
  // The dialog handles user confirmation and TTL selection; this callback
  // just performs the mint and surfaces errors as the dialog's error state.
  const mintPublicLink = useCallback(
    async (entry: DufsEntry, opts: { ttlSeconds?: number; permanent?: boolean }) => {
      const path = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
      return createFileExportUrl(workspaceId, path, { ...opts, isDir: isDir(entry) })
    },
    [currentPath, workspaceId],
  )

  const requestPublicLink = useCallback((entry: DufsEntry) => {
    setPublicLinkTarget(entry)
    setPublicLinkOpen(true)
  }, [])

  const downloadUrl = (entry: DufsEntry) => {
    const path = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
    return isDir(entry) ? dirZipUrl(workspaceId, path, drive) : fileUrl(workspaceId, path, drive)
  }

  // ---------------------------------------------------------------------------
  // Selection (multi-select + batch ops)
  // ---------------------------------------------------------------------------

  const allSelected = sortedEntries.length > 0 && selected.size === sortedEntries.length
  const someSelected = selected.size > 0 && !allSelected

  const toggleOne = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    lastAnchorRef.current = name
  }

  const selectRangeTo = (name: string) => {
    const names = sortedEntries.map((e) => e.name)
    const anchor = lastAnchorRef.current
    if (!anchor || !names.includes(anchor)) {
      toggleOne(name)
      return
    }
    const a = names.indexOf(anchor)
    const b = names.indexOf(name)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setSelected((prev) => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i++) next.add(names[i])
      return next
    })
  }

  // Finder-like row click: plain = "select only", ⌘/Ctrl = toggle, shift = range.
  // Open is handled separately via double-click.
  const handleRowClick = (entry: DufsEntry, e: React.MouseEvent) => {
    if (e.shiftKey && lastAnchorRef.current) {
      e.preventDefault()
      selectRangeTo(entry.name)
      return
    }
    if (e.metaKey || e.ctrlKey) {
      toggleOne(entry.name)
      return
    }
    setSelected(new Set([entry.name]))
    lastAnchorRef.current = entry.name
  }

  const handleRowOpen = (entry: DufsEntry) => {
    if (isDir(entry)) {
      navigate(`${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}/`)
    } else {
      openFile(entry)
    }
  }

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(sortedEntries.map((e) => e.name)))
    lastAnchorRef.current = null
  }

  const clearSelection = () => {
    setSelected(new Set())
    lastAnchorRef.current = null
  }

  const batchDeleteMutation = useMutation({
    mutationFn: async (names: string[]) => {
      const failures: string[] = []
      await Promise.all(
        names.map(async (name) => {
          const path = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${name}`
          const resp = await fetch(fileUrl(workspaceId, path, drive), { method: 'DELETE' })
          if (!resp.ok) failures.push(name)
        }),
      )
      if (failures.length > 0) {
        throw new Error(
          t('components.workspaceFiles.errors.deleteFailed', { name: failures.join(', ') }),
        )
      }
    },
    onSettled: () => {
      clearSelection()
      invalidateListing()
    },
  })

  // Two-click confirm on batch delete: first click arms (button flips to a
  // stronger destructive state with a "click again" label); second click
  // within 3s actually fires the mutation. Disarms on selection change,
  // mutation start, or timeout.
  const [batchDeleteArmed, setBatchDeleteArmed] = useState(false)
  const batchDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(batchDeleteTimerRef.current), [])
  useEffect(() => {
    // Disarm if the selection changes while armed — the new selection isn't
    // what the user just confirmed.
    setBatchDeleteArmed(false)
    clearTimeout(batchDeleteTimerRef.current)
  }, [selected])

  const handleBatchDelete = () => {
    if (!batchDeleteArmed) {
      setBatchDeleteArmed(true)
      clearTimeout(batchDeleteTimerRef.current)
      batchDeleteTimerRef.current = setTimeout(() => setBatchDeleteArmed(false), 3000)
      return
    }
    clearTimeout(batchDeleteTimerRef.current)
    setBatchDeleteArmed(false)
    batchDeleteMutation.mutate(Array.from(selected))
  }

  const handleBatchDownload = () => {
    // Browser-side fan-out: trigger one download per selected entry. Folders
    // hit the zip endpoint, files hit fileUrl directly. Sequential anchor
    // clicks with a small spacing keep the browser's download manager happy.
    const items = sortedEntries.filter((e) => selected.has(e.name))
    items.forEach((entry, i) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = downloadUrl(entry)
        a.download = isDir(entry) ? `${entry.name}.zip` : entry.name
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }, i * 120)
    })
  }

  // ---------------------------------------------------------------------------
  // Internal DnD (row → folder / breadcrumb = move within the same drive)
  // ---------------------------------------------------------------------------

  const INTERNAL_MIME = 'application/x-nap-files-move'
  type InternalDragPayload = { fromDir: string; drive: DriveKind; names: string[] }
  // Browsers hide dataTransfer payload from JS during dragOver (security). We
  // stash the active payload here on dragStart so dropTarget validation can
  // see it without the actual data.
  const internalDragPayloadRef = useRef<InternalDragPayload | null>(null)

  // Unified drag preview — always a primary pill with "Moving N item(s)",
  // regardless of count. Replaces the browser's default row screenshot for
  // single-item drags so the drag identity is consistent.
  const buildDragImage = (count: number): HTMLElement => {
    const el = document.createElement('div')
    el.textContent = t('components.workspaceFiles.selection.dragBadge', { count })
    el.style.cssText =
      'position:absolute;top:-1000px;left:-1000px;padding:4px 10px;border-radius:9999px;background:oklch(var(--primary));color:oklch(var(--primary-foreground));font:500 12px ui-sans-serif,system-ui;box-shadow:0 4px 14px rgba(0,0,0,0.18);white-space:nowrap;'
    document.body.appendChild(el)
    // Clean up next tick (browser snapshots immediately).
    setTimeout(() => el.remove(), 0)
    return el
  }

  const handleRowDragStart = (entry: DufsEntry, e: React.DragEvent) => {
    if (!writeAllowed) {
      e.preventDefault()
      return
    }
    // If the row being dragged isn't part of the current selection, drag just
    // that row (and replace selection). Otherwise drag the whole selection.
    let names: string[]
    if (selected.has(entry.name) && selected.size > 1) {
      names = Array.from(selected)
    } else {
      names = [entry.name]
      setSelected(new Set([entry.name]))
      lastAnchorRef.current = entry.name
    }
    const payload: InternalDragPayload = { fromDir: currentPath, drive, names }
    internalDragPayloadRef.current = payload
    setIsInternalDragActive(true)
    e.dataTransfer.setData(INTERNAL_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
    const ghost = buildDragImage(names.length)
    e.dataTransfer.setDragImage(ghost, 16, 16)
  }

  const handleRowDragEnd = () => {
    internalDragPayloadRef.current = null
    setInternalDropTarget(null)
    setIsInternalDragActive(false)
  }

  const isInternalDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes(INTERNAL_MIME)

  const moveBatch = useMutation({
    mutationFn: async ({
      payload,
      destDir,
    }: {
      payload: InternalDragPayload
      destDir: string
    }) => {
      const failures: string[] = []
      await Promise.all(
        payload.names.map(async (name) => {
          const src = `${payload.fromDir}${payload.fromDir.endsWith('/') ? '' : '/'}${name}`
          const dest = `${destDir}${destDir.endsWith('/') ? '' : '/'}${name}`
          const resp = await move(workspaceId, src, dest, payload.drive)
          if (!resp.ok) failures.push(name)
        }),
      )
      if (failures.length > 0) {
        throw new Error(
          t('components.workspaceFiles.errors.moveFailed', { name: failures.join(', ') }),
        )
      }
    },
    onSettled: () => {
      setInternalDropTarget(null)
      clearSelection()
      invalidateListing()
    },
  })

  // Drop validity, computed against the active drag payload stashed on
  // dragStart (browsers hide the real payload during dragOver).
  const canDropOnFolder = (entry: DufsEntry) => {
    const payload = internalDragPayloadRef.current
    if (!writeAllowed) return false
    if (!isDir(entry)) return false
    if (!payload || payload.drive !== drive) return false
    if (payload.fromDir !== currentPath) return false // cross-dir not supported in v1
    if (payload.names.includes(entry.name)) return false // can't move into self
    return true
  }

  const canDropOnBreadcrumb = (path: string) => {
    const payload = internalDragPayloadRef.current
    if (!writeAllowed) return false
    if (!payload || payload.drive !== drive) return false
    if (!path.endsWith('/')) return false // file leaf, not a directory target
    if (path === currentPath) return false // same dir = no-op
    return true
  }

  const readInternalPayload = (e: React.DragEvent): InternalDragPayload | null => {
    const raw = e.dataTransfer.getData(INTERNAL_MIME)
    if (!raw) return null
    try {
      return JSON.parse(raw) as InternalDragPayload
    } catch {
      return null
    }
  }

  const handleFolderDragOver = (entry: DufsEntry, e: React.DragEvent) => {
    if (isExternalDrag(e)) {
      if (!writeAllowed || !isDir(entry)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (internalDropTarget !== `entry:${entry.name}`) {
        setInternalDropTarget(`entry:${entry.name}`)
      }
      return
    }
    if (!isInternalDrag(e)) return
    if (!canDropOnFolder(entry)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (internalDropTarget !== `entry:${entry.name}`) {
      setInternalDropTarget(`entry:${entry.name}`)
    }
  }

  const handleFolderDragLeave = (entry: DufsEntry) => {
    if (internalDropTarget === `entry:${entry.name}`) setInternalDropTarget(null)
  }

  const handleFolderDrop = async (entry: DufsEntry, e: React.DragEvent) => {
    if (isExternalDrag(e)) {
      e.preventDefault()
      e.stopPropagation()
      // Reset container drag state — the bubbled-prevented drop would have
      // otherwise left counters/overlay in a stuck state.
      externalDragCounter.current = 0
      setIsExternalDragging(false)
      setInternalDropTarget(null)
      if (!writeAllowed || !isDir(entry)) return
      const destDir = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}/`
      await uploadDataTransfer(e.dataTransfer, destDir)
      return
    }
    if (!isInternalDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const payload = readInternalPayload(e)
    if (!payload) return
    if (!canDropOnFolder(entry)) return
    const destDir = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}/`
    moveBatch.mutate({ payload, destDir })
  }

  const handleBreadcrumbDragOver = (path: string, e: React.DragEvent) => {
    if (!isInternalDrag(e)) return
    if (!canDropOnBreadcrumb(path)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (internalDropTarget !== `crumb:${path}`) setInternalDropTarget(`crumb:${path}`)
  }

  const handleBreadcrumbDragLeave = (path: string) => {
    if (internalDropTarget === `crumb:${path}`) setInternalDropTarget(null)
  }

  const handleBreadcrumbDrop = (path: string, e: React.DragEvent) => {
    if (!isInternalDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const payload = readInternalPayload(e)
    if (!payload) return
    if (!canDropOnBreadcrumb(path)) return
    moveBatch.mutate({ payload, destDir: path })
  }

  // Breadcrumb segments. When viewing a file, we append the filename as a
  // trailing non-clickable crumb (path === viewingPath, but the renderer
  // treats it as the file leaf and disables navigation on it).
  //
  // When `rootPath` is set, breadcrumbs are re-based: segments above the
  // fence are hidden, and the first crumb represents the fence itself. The
  // first crumb's label defaults to the fence's last segment so the user
  // still has a meaningful "home" target (e.g. `team-abc123`).
  const allSegments = currentPath.split('/').filter(Boolean)
  const visibleSegments = allSegments.slice(rootSegments)
  const driveRootLabel = drive === 'workspace' ? '/workspace' : '/mnt/afs'
  const effectiveRootLabel =
    normalizedRoot === '/'
      ? driveRootLabel
      : (rootLabel ?? allSegments[rootSegments - 1] ?? driveRootLabel)
  const fileLeaf = isViewingFile ? viewingPath.split('/').filter(Boolean).pop() : null
  const breadcrumbs = [
    { label: effectiveRootLabel, path: normalizedRoot },
    ...visibleSegments.map((seg, i) => ({
      label: seg,
      path: `${normalizedRoot}${visibleSegments.slice(0, i + 1).join('/')}/`,
    })),
    ...(fileLeaf
      ? [{ label: fileLeaf, path: viewingPath }] // viewingPath has no trailing slash
      : []),
  ]

  // Truncate deep paths: first crumb + ellipsis + last 2 crumbs.
  // Each truncated crumb stays clickable; ellipsis is a visual marker only.
  type Crumb = { label: string; path: string }
  type CrumbItem = { kind: 'crumb'; crumb: Crumb } | { kind: 'ellipsis' }
  const displayBreadcrumbs: CrumbItem[] =
    breadcrumbs.length > 4
      ? [
          { kind: 'crumb', crumb: breadcrumbs[0] },
          { kind: 'ellipsis' },
          { kind: 'crumb', crumb: breadcrumbs[breadcrumbs.length - 2] },
          { kind: 'crumb', crumb: breadcrumbs[breadcrumbs.length - 1] },
        ]
      : breadcrumbs.map((c) => ({ kind: 'crumb', crumb: c }))

  // External (OS) file drag-and-drop. Internal row drags are handled per-row /
  // per-breadcrumb below. We distinguish by inspecting `dataTransfer.types`:
  // OS drags include 'Files'; internal drags carry our custom mime only.
  const isExternalDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return
    e.preventDefault()
    externalDragCounter.current++
    if (externalDragCounter.current === 1) setIsExternalDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return
    e.preventDefault()
    externalDragCounter.current--
    if (externalDragCounter.current === 0) setIsExternalDragging(false)
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return
    e.preventDefault()
  }
  const handleDrop = async (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return
    e.preventDefault()
    externalDragCounter.current = 0
    setIsExternalDragging(false)
    if (!writeAllowed) return
    await uploadDataTransfer(e.dataTransfer, currentPath)
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            {/* Drive switcher — hidden while viewing a file (switching drives
                mid-preview makes no sense; back to dir first) or when the
                host has locked us to a single drive. */}
            {!isViewingFile && !lockedDrive && (
              <Tabs
                value={drive}
                onValueChange={(v) => setDrive(v as DriveKind)}
                className="shrink-0"
              >
                <TabsList className="h-7 p-0.5">
                  <TabsTrigger value="workspace" className="h-6 px-2 text-xs">
                    {t('components.workspaceFiles.drives.workspace')}
                  </TabsTrigger>
                  <TabsTrigger value="afs" className="h-6 px-2 text-xs">
                    {t('components.workspaceFiles.drives.afs')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {/* Actions — directory ops when listing, file ops when viewing.
                File ops are portaled in by FileViewer via `fileActionsSlot`. */}
            {isViewingFile ? (
              <div ref={setFileActionsSlot} className="flex shrink-0 items-center gap-0.5">
                <AppHeaderButton
                  icon={RefreshCw}
                  title={t('components.workspaceFiles.actions.refresh')}
                  onClick={refresh}
                />
                {/* FileViewer portals its action buttons here */}
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-0.5">
                <AppHeaderButton
                  icon={Search}
                  title={t('components.workspaceFiles.actions.search')}
                  data-state={isSearching ? 'open' : undefined}
                  onClick={() => {
                    if (isSearching) {
                      setIsSearching(false)
                      setSearchQuery('')
                    } else {
                      setIsSearching(true)
                    }
                  }}
                />
                <AppHeaderButton
                  icon={Upload}
                  title={
                    writeAllowed
                      ? t('components.workspaceFiles.actions.upload')
                      : t('components.workspaceFiles.actions.uploadDisabled')
                  }
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!writeAllowed}
                />
                <AppHeaderButton
                  icon={FilePlus}
                  title={
                    writeAllowed
                      ? t('components.workspaceFiles.actions.newFile')
                      : t('components.workspaceFiles.actions.newFileDisabled')
                  }
                  onClick={() => {
                    setNewFileParent(currentPath)
                    setNewFileOpen(true)
                  }}
                  disabled={!writeAllowed}
                />
                <AppHeaderButton
                  icon={FolderPlus}
                  title={
                    writeAllowed
                      ? t('components.workspaceFiles.actions.newFolder')
                      : t('components.workspaceFiles.actions.newFolderDisabled')
                  }
                  onClick={() => setMkdirOpen(true)}
                  disabled={!writeAllowed}
                />
                <AppHeaderButton
                  icon={Link2}
                  title={t('components.workspaceFiles.actions.managePublicLinks')}
                  onClick={() => setManagePublicLinksOpen(true)}
                />
                <AppHeaderButton
                  icon={RefreshCw}
                  title={t('components.workspaceFiles.actions.refresh')}
                  onClick={refresh}
                />
              </div>
            )}

            {/* Breadcrumb — flex-1 absorbs the rest; truncates when deep.
                When searching, the slot becomes a search input instead. */}
            {isSearching ? (
              <div className="flex min-w-0 flex-1 items-center">
                <Input
                  autoFocus
                  placeholder={t('components.workspaceFiles.placeholders.search')}
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsSearching(false)
                      setSearchQuery('')
                    }
                  }}
                  className="h-7 w-full text-xs"
                />
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs">
                {displayBreadcrumbs.map((item, i) => {
                  const isLast = i === displayBreadcrumbs.length - 1
                  if (item.kind === 'ellipsis') {
                    return (
                      <span key={`ellipsis-${i}`} className="flex shrink-0 items-center gap-0.5">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/80" />
                        <span className="text-muted-foreground/80">…</span>
                      </span>
                    )
                  }
                  const { crumb } = item
                  const isFileLeaf = !crumb.path.endsWith('/')
                  const isDropActive = internalDropTarget === `crumb:${crumb.path}`
                  const isDropCandidate = isInternalDragActive && canDropOnBreadcrumb(crumb.path)
                  // Last crumb is allowed to shrink so its inner truncate kicks
                  // in when the panel narrows; earlier ancestors stay shrink-0
                  // (so they remain easy to click in the common case).
                  return (
                    <span
                      key={crumb.path}
                      className={cn('flex min-w-0 items-center gap-0.5', isLast ? '' : 'shrink-0')}
                      title={isLast ? crumb.path : undefined}
                    >
                      {i > 0 && (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                      )}
                      {isFileLeaf ? (
                        <span className="truncate px-1 font-medium text-foreground">
                          {crumb.label}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`truncate rounded px-1 transition-colors ${
                            isDropActive
                              ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                              : isDropCandidate
                                ? 'bg-primary/[0.06] text-primary/80 ring-1 ring-primary/15'
                                : isLast
                                  ? 'font-medium text-foreground hover:text-foreground'
                                  : 'text-muted-foreground/80 hover:text-foreground'
                          }`}
                          onClick={() => navigate(crumb.path)}
                          onDragOver={(e) => handleBreadcrumbDragOver(crumb.path, e)}
                          onDragLeave={() => handleBreadcrumbDragLeave(crumb.path)}
                          onDrop={(e) => handleBreadcrumbDrop(crumb.path, e)}
                        >
                          {crumb.label}
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
            {isViewingFile && !isSearching && (
              <AppHeaderButton
                icon={pathCopied ? ClipboardCheck : Copy}
                title={
                  pathCopied
                    ? t('components.workspaceFiles.actions.copiedPath')
                    : t('components.workspaceFiles.actions.copyPath')
                }
                onClick={handleCopyPath}
                className={pathCopied ? 'text-success hover:text-success' : ''}
              />
            )}
          </>,
          headerSlot,
        )}

      <div
        className="relative flex h-full flex-col"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay — dashed primary frame + centered hint, sits inside the
            AppWindow body so the chrome doesn't shift under it. */}
        {isExternalDragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/50 bg-primary/[0.06] backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">
                {t('components.workspaceFiles.states.dropToUpload')}
              </span>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files)
            e.target.value = ''
          }}
        />

        {/* Upload progress */}
        {uploading && (
          <div className="shrink-0 border-b border-foreground/[0.08] px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-3.5 w-3.5 animate-pulse" />
              <span className="min-w-0 truncate">
                {uploads.size === 1
                  ? t('components.workspaceFiles.upload.progressSingle', {
                      name: uploads.values().next().value?.fileName ?? '',
                      percent: overallProgress,
                    })
                  : t('components.workspaceFiles.upload.progressMultiple', {
                      count: uploads.size,
                      percent: overallProgress,
                    })}
              </span>
            </div>
            <Progress value={overallProgress} className="mt-1.5 h-1.5" />
          </div>
        )}

        {/* Content */}
        {isViewingFile ? (
          <FileViewer
            filePath={viewingPath}
            workspaceId={workspaceId}
            instanceId={instanceId}
            drive={drive}
            canEdit={writeAllowed}
            refreshToken={fileRefreshToken}
            headerSlot={fileActionsSlot}
            onPrevImage={goToPrevImage}
            onNextImage={goToNextImage}
            viewingLine={viewingLine}
            viewingColumn={viewingColumn}
            onPopOut={(path) => {
              slotCtx.openInPopout('file', {
                viewingPath: path,
                drive,
                viewingLine,
                viewingColumn,
              })
              closeFile()
            }}
          />
        ) : drive === 'afs' && currentPath === '/' ? (
          <AfsSharesPanel
            workspaceId={workspaceId}
            searchQuery={searchQuery}
            onOpenShare={(name) => navigate(`/${name}/`)}
            refreshToken={afsRefreshToken}
          />
        ) : listingError || newFileMutation.error || mkdirMutation.error ? (
          <div className="p-3">
            <Alert variant="destructive">
              <AlertDescription>
                {listingError ??
                  (newFileMutation.error instanceof Error ? newFileMutation.error.message : null) ??
                  (mkdirMutation.error instanceof Error ? mkdirMutation.error.message : null)}
              </AlertDescription>
            </Alert>
          </div>
        ) : isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyHero
              illustration={
                <EmptyIllustration src={searchQuery ? 'search' : 'files'} size="h-32" />
              }
              title={t(
                searchQuery
                  ? 'components.workspaceFiles.empty.noResults.title'
                  : 'components.workspaceFiles.empty.directory.title',
              )}
              description={t(
                searchQuery
                  ? 'components.workspaceFiles.empty.noResults.description'
                  : 'components.workspaceFiles.empty.directory.description',
              )}
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            {selected.size > 0 ? (
              // Selection action bar — replaces the column header. Fixed h-8
              // matches the column-header height so swapping doesn't jump.
              <div className="relative isolate sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-foreground/[0.08] bg-card px-3 text-xs before:absolute before:inset-0 before:-z-10 before:bg-primary/[0.06]">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label={t('components.workspaceFiles.selection.toggleAll')}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {t('components.workspaceFiles.selection.count', { count: selected.size })}
                </span>
                <button
                  type="button"
                  className="flex h-6 items-center gap-1 rounded px-2 text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                  onClick={handleBatchDownload}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('components.workspaceFiles.selection.download')}
                </button>
                {writeAllowed && (
                  <button
                    type="button"
                    className={
                      batchDeleteArmed
                        ? 'flex h-6 items-center gap-1 rounded bg-destructive/15 px-2 font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50'
                        : 'flex h-6 items-center gap-1 rounded px-2 text-destructive/90 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50'
                    }
                    onClick={handleBatchDelete}
                    disabled={batchDeleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {batchDeleteArmed
                      ? t('components.workspaceFiles.selection.deleteConfirm', {
                          count: selected.size,
                        })
                      : t('components.workspaceFiles.selection.delete')}
                  </button>
                )}
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                  onClick={clearSelection}
                  title={t('components.workspaceFiles.selection.clear')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-foreground/[0.08] bg-card px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center text-left transition-colors hover:text-foreground"
                  onClick={() => handleSortClick('name')}
                >
                  <span className="truncate">{t('components.workspaceFiles.columns.name')}</span>
                  <SortIndicator col="name" />
                </button>
                <button
                  type="button"
                  className="flex shrink-0 w-24 items-center justify-end tabular-nums transition-colors hover:text-foreground"
                  onClick={() => handleSortClick('mtime')}
                >
                  {t('components.workspaceFiles.columns.mtime')}
                  <SortIndicator col="mtime" />
                </button>
                <button
                  type="button"
                  className="flex shrink-0 w-16 items-center justify-end tabular-nums transition-colors hover:text-foreground"
                  onClick={() => handleSortClick('size')}
                >
                  {t('components.workspaceFiles.columns.size')}
                  <SortIndicator col="size" />
                </button>
                {/* Spacer to align with action menu column */}
                <span className="shrink-0 w-6" aria-hidden />
              </div>
            )}
            <div className="divide-y divide-foreground/[0.05]">
              {sortedEntries.map((entry) => {
                const isSelected = selected.has(entry.name)
                const isDropActive = internalDropTarget === `entry:${entry.name}`
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: row uses native keyboard nav via parent listbox
                  <div
                    key={entry.name}
                    draggable={writeAllowed}
                    onDragStart={(e) => handleRowDragStart(entry, e)}
                    onDragEnd={handleRowDragEnd}
                    onDragOver={(e) => handleFolderDragOver(entry, e)}
                    onDragLeave={() => handleFolderDragLeave(entry)}
                    onDrop={(e) => handleFolderDrop(entry, e)}
                    onClick={(e) => handleRowClick(entry, e)}
                    onDoubleClick={() => handleRowOpen(entry)}
                    data-selected={isSelected || undefined}
                    className={`group relative flex select-none items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                      isDropActive
                        ? 'bg-primary/10'
                        : isSelected
                          ? 'bg-primary/[0.08] hover:bg-primary/[0.10]'
                          : 'hover:bg-foreground/[0.04]'
                    }`}
                  >
                    {/* Selection lit pill — echoes dock active indicator */}
                    {isSelected && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-primary/70"
                      />
                    )}

                    {/* Icon + name — single-click selects (handled on row),
                    double-click opens. The whole row is the hit target. */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {isDir(entry) ? (
                        <Folder className="h-4 w-4 shrink-0 text-chart-1" />
                      ) : (
                        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{entry.name}</span>
                    </div>

                    {/* Last update — relative on the row, full timestamp on hover. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0 w-24 cursor-default text-right text-xs text-muted-foreground tabular-nums">
                          {formatRelativeTime(entry.mtime, i18n.language)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs tabular-nums">
                        {formatFullTime(entry.mtime, i18n.language)}
                      </TooltipContent>
                    </Tooltip>

                    {/* Size */}
                    <span className="shrink-0 w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {entry.path_type === 'File' ? formatSize(entry.size) : ''}
                    </span>

                    {/* Actions — stopPropagation so opening the menu doesn't
                    also fire the row's select / dbl-open handlers. */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <FileEntryMenu
                        entry={entry}
                        downloadUrl={downloadUrl(entry)}
                        onNewFile={
                          writeAllowed && isDir(entry)
                            ? () => {
                                const subPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}/`
                                setNewFileParent(subPath)
                                setNewFileOpen(true)
                              }
                            : undefined
                        }
                        onNewFolder={
                          writeAllowed && isDir(entry)
                            ? () => {
                                const subPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}/`
                                navigate(subPath)
                                setMkdirOpen(true)
                              }
                            : undefined
                        }
                        onRename={
                          writeAllowed
                            ? () => {
                                setRenameTarget(entry)
                                setRenameOpen(true)
                              }
                            : undefined
                        }
                        onDelete={writeAllowed ? () => handleDelete(entry) : undefined}
                        onCreatePublicLink={
                          drive === 'workspace' ? () => requestPublicLink(entry) : undefined
                        }
                        onAddToChat={
                          drive === 'workspace' && !isDir(entry)
                            ? () => {
                                const full = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${entry.name}`
                                requestComposerInsert(
                                  workspaceId,
                                  `@file/${full.replace(/^\/+/, '')}`,
                                )
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}

        {/* New File Dialog */}
        <NewFileDialog
          open={newFileOpen}
          onOpenChange={(open) => {
            setNewFileOpen(open)
            if (!open) setNewFileParent(null)
          }}
          onSubmit={(name) => handleNewFile(newFileParent ?? currentPath, name)}
        />

        {/* New Folder Dialog */}
        <NewFolderDialog open={mkdirOpen} onOpenChange={setMkdirOpen} onSubmit={handleMkdir} />

        {/* Rename Dialog */}
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          currentName={renameTarget?.name ?? ''}
          onRename={handleRename}
        />

        {/* Public link dialog */}
        <PublicLinkDialog
          open={publicLinkOpen}
          onOpenChange={(open) => {
            setPublicLinkOpen(open)
            if (!open) setPublicLinkTarget(null)
          }}
          filePath={
            publicLinkTarget
              ? `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${publicLinkTarget.name}`
              : null
          }
          isDir={publicLinkTarget ? isDir(publicLinkTarget) : false}
          onGenerate={(opts) => {
            if (!publicLinkTarget) return Promise.reject(new Error('no target'))
            return mintPublicLink(publicLinkTarget, opts)
          }}
        />

        {/* Manage public links dialog */}
        <ManagePublicLinksDialog
          open={managePublicLinksOpen}
          onOpenChange={setManagePublicLinksOpen}
          load={() => listFileExportTokens(workspaceId)}
          onRevoke={(token) => revokeFileExportToken(workspaceId, token)}
        />
      </div>
    </>
  )
}
