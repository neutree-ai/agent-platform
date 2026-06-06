import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { type DriveKind, filePreviewUrl, fileUrl, isBinaryPreviewFile } from '@/lib/api/agent-files'
import { useInstanceState } from '@/stores/instance-state-store'
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  Pencil,
  Save,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FilePreview } from './file-preview/FilePreview'

interface FileViewerProps {
  /** File path relative to workspace root (e.g. "/docs/README.md") */
  filePath: string
  /** Workspace ID for building the fetch URL */
  workspaceId: string
  /**
   * Owning app instance id. The editing session (isEditing / editedContent /
   * editedBytes and the fetched baseline) is keyed by this in the per-instance
   * store, so a layout switch or fill toggle — which remounts FileViewer as it
   * moves between two tree positions in WorkspacePage — no longer silently
   * discards the user's unsaved draft.
   */
  instanceId: string
  /** Which drive the path lives on (default 'workspace'). */
  drive?: DriveKind
  /** Whether editing is allowed (default true). Used to hide edit UI for RO afs shares. */
  canEdit?: boolean
  /** Called when user clicks the back/close button. If omitted, no back button shown. */
  onClose?: () => void
  /** Called when user clicks the "pop out" button. If omitted, no pop-out button shown. */
  onPopOut?: (path: string) => void
  /** Whether to show the header bar (default true) */
  showHeader?: boolean
  /** When provided, action buttons portal into this DOM node instead of
   *  rendering an inline header bar. Lets the host (e.g. WorkspaceFilesPanel)
   *  unify the file actions with its own AppWindow header chrome. */
  headerSlot?: HTMLElement | null
  /** Called after a file is successfully saved. */
  onSave?: () => void
  /** Bumped by the parent to force a re-fetch of content and preview. */
  refreshToken?: number
  /** Image-only sibling navigation. Null when there is no prev/next. */
  onPrevImage?: (() => void) | null
  onNextImage?: (() => void) | null
  /** 1-based jump target; ignored by non-code previews. */
  viewingLine?: number
  viewingColumn?: number
}

export function FileViewer({
  filePath,
  workspaceId,
  instanceId,
  drive = 'workspace',
  canEdit = true,
  onClose,
  onPopOut,
  onSave,
  showHeader = true,
  headerSlot,
  refreshToken = 0,
  onPrevImage,
  onNextImage,
  viewingLine,
  viewingColumn,
}: FileViewerProps) {
  const { t } = useTranslation()
  // The editing session lives in per-instance state, not component-local
  // useState: a layout / fill switch remounts FileViewer, and useState would
  // reset isEditing back to the preview and — worse — drop the unsaved
  // editedContent draft. Keying by instanceId (one bag per app instance, the
  // current file overwrites the previous on navigation) keeps memory bounded.
  const [fileContent, setFileContent] = useInstanceState(instanceId, 'fileContent', () => '')
  const [editedContent, setEditedContent] = useInstanceState(instanceId, 'editedContent', () => '')
  // editedBytes carries the most recent serialized form for binary editors
  // (currently only xlsx). Null when the user hasn't touched anything since
  // entering edit mode, so we can distinguish "Done (no changes)" from "Save".
  const [editedBytes, setEditedBytes] = useInstanceState<Uint8Array | null>(
    instanceId,
    'editedBytes',
    () => null,
  )
  const [isEditing, setIsEditing] = useInstanceState(instanceId, 'isEditing', () => false)
  // Transient render-cycle flags — no value in surviving a remount.
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const url = fileUrl(workspaceId, filePath, drive)
  const previewUrl = filePreviewUrl(workspaceId, filePath, drive)
  const isBinary = isBinaryPreviewFile(filePath)
  // xlsx is binary-fetched but supports an inline editor; the rest of the
  // binary set (pdf/doc/ppt) stays view-only.
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const isBinaryEditable = ext === 'xlsx' || ext === 'xls'
  // Cache-buster appended to fetch URLs so the refresh button bypasses both
  // the React effect's dep-cache and the browser's HTTP cache.
  const busterSuffix = refreshToken > 0 ? `&_r=${refreshToken}` : ''
  const fetchUrl = `${url}${busterSuffix}`
  const fetchPreviewUrl = `${previewUrl}${busterSuffix}`

  // Fetch file content when path changes, or when the parent bumps
  // refreshToken (which mutates fetchUrl via a cache-buster).
  //
  // - Path change = context change → clear the stale content and show the
  //   spinner. The old file's text would be misleading during the load.
  // - Same path, fetchUrl changed (refreshToken bump) = background refetch →
  //   keep the currently rendered content up until the new text arrives, so
  //   agent-driven auto-refresh doesn't flash the spinner.
  // - Skip background refetches while the user is editing; refetching would
  //   overwrite editedContent and silently discard unsaved changes.
  //
  // The "what file is the bag holding" marker is instance state, not a ref: a
  // ref is re-seeded to `filePath` on every remount, so a fill/layout switch
  // followed by opening a *different* file would read false `pathChanged` and
  // serve the previous file's stale draft. Instance state survives the remount
  // and is overwritten on genuine navigation, so the comparison stays honest.
  const [lastLoadedPath, setLastLoadedPath] = useInstanceState(
    instanceId,
    'lastLoadedPath',
    () => '',
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: isEditing / lastLoadedPath are read at fire-time by design; the effect re-runs on fetchUrl (which encodes the path), not when these change
  useEffect(() => {
    const pathChanged = lastLoadedPath !== filePath

    if (pathChanged) {
      setLastLoadedPath(filePath)
      setIsEditing(false)
      setFileContent('')
      setEditedContent('')
      setEditedBytes(null)
    } else if (isEditing) {
      return
    }

    if (isBinary) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    if (pathChanged) setIsLoading(true)
    fetch(fetchUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.text()
      })
      .then((text) => {
        if (cancelled) return
        setFileContent(text)
        setEditedContent(text)
      })
      .catch(() => {
        if (!cancelled && pathChanged) setFileContent('')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fetchUrl, isBinary])

  const hasChanges = isEditing && (editedContent !== fileContent || editedBytes !== null)

  const handleCopy = useCallback(() => {
    const text = isEditing ? editedContent : fileContent
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [isEditing, editedContent, fileContent])

  // Download the raw file via the same bytes endpoint the directory list and
  // context menu use. Uses the cache-buster-free `url` so the download always
  // hits the canonical resource; the browser's `download` attribute names the
  // saved file after its basename.
  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = url
    a.download = filePath.split('/').pop() || 'download'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [url, filePath])

  // Single primary action button for the editor lifecycle. Three states:
  //   - not editing      → "Edit"   → enter edit mode
  //   - editing, no diff → "Done"   → exit edit mode (no PUT, content unchanged)
  //   - editing + diff   → "Save"   → PUT, then exit. Discard path is implicit
  //                                    (navigate away / open another file).
  const handlePrimaryAction = useCallback(async () => {
    if (!isEditing) {
      setIsEditing(true)
      return
    }
    // Binary editor path (xlsx): PUT the serialized bytes if the user touched
    // anything; otherwise treat it as "Done" and just exit edit mode.
    if (editedBytes) {
      setIsSaving(true)
      try {
        const resp = await fetch(url, {
          method: 'PUT',
          body: new Blob([editedBytes as BlobPart]),
        })
        if (resp.ok) {
          setEditedBytes(null)
          setIsEditing(false)
          onSave?.()
        }
      } finally {
        setIsSaving(false)
      }
      return
    }
    if (editedContent === fileContent) {
      setIsEditing(false)
      return
    }
    setIsSaving(true)
    try {
      const resp = await fetch(url, {
        method: 'PUT',
        body: editedContent,
      })
      if (resp.ok) {
        setFileContent(editedContent)
        setIsEditing(false)
        onSave?.()
      }
    } finally {
      setIsSaving(false)
    }
    // setFileContent / setEditedBytes / setIsEditing come from useInstanceState
    // — stable across renders (memoized on workspace/instance/key) but, unlike
    // useState setters, not auto-recognized as stable by the linter.
  }, [
    isEditing,
    editedContent,
    editedBytes,
    fileContent,
    url,
    onSave,
    setFileContent,
    setEditedBytes,
    setIsEditing,
  ])

  // Action buttons. Rendered inline (below) or portaled into a host slot
  // (WorkspaceFilesPanel) so the AppWindow header is the single source of
  // chrome instead of stacking two strips.
  //
  // Edit/Save/Done are merged into a single button (see handlePrimaryAction).
  // The icon and tone shift with the editor state so the button is its own
  // status indicator.
  let primaryIcon = Pencil
  let primaryTitle = t('components.fileViewer.actions.edit')
  let primaryClass = ''
  if (isEditing) {
    if (hasChanges) {
      primaryIcon = Save
      primaryTitle = t('components.fileViewer.actions.save')
      primaryClass = 'text-primary hover:text-primary'
    } else {
      primaryIcon = Check
      primaryTitle = t('components.fileViewer.actions.doneEditing')
    }
  }

  const actions = (
    <>
      {!isBinary && (
        <AppHeaderButton
          icon={copied ? ClipboardCheck : Copy}
          title={
            copied
              ? t('components.fileViewer.actions.copied')
              : t('components.fileViewer.actions.copyContent')
          }
          onClick={handleCopy}
          className={copied ? 'text-success hover:text-success' : ''}
        />
      )}
      <AppHeaderButton
        icon={Download}
        title={t('components.fileViewer.actions.download')}
        onClick={handleDownload}
      />
      {canEdit && (!isBinary || isBinaryEditable) && (
        <AppHeaderButton
          icon={isSaving ? undefined : primaryIcon}
          title={primaryTitle}
          onClick={handlePrimaryAction}
          disabled={isSaving}
          data-state={isEditing ? 'open' : undefined}
          className={primaryClass}
        >
          {isSaving && <Spinner className="h-3.5 w-3.5" />}
        </AppHeaderButton>
      )}
      {onPopOut && (
        <AppHeaderButton
          icon={ExternalLink}
          title={t('components.fileViewer.actions.openInOverlay')}
          onClick={() => onPopOut(filePath)}
        />
      )}
    </>
  )

  // Three rendering modes:
  // 1. headerSlot provided: portal actions into host's chrome, no inline header
  // 2. showHeader=true (default, no slot): full inline header with path + back
  // 3. showHeader=false: bare body, no header at all
  const showInlineHeader = showHeader && !headerSlot

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {headerSlot &&
        createPortal(
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>,
          headerSlot,
        )}
      {showInlineHeader && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-foreground/[0.08] px-3 py-1.5">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-foreground/[0.06]"
              onClick={onClose}
              title={t('components.fileViewer.actions.backToList')}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {drive === 'afs' ? '/mnt/afs' : '/workspace'}
            {filePath}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        </div>
      )}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <FilePreview
          filename={filePath}
          fileUrl={fetchUrl}
          previewUrl={fetchPreviewUrl}
          content={isEditing ? editedContent : fileContent}
          isEditing={isEditing}
          onChange={isEditing ? setEditedContent : undefined}
          onBytesChange={isEditing ? setEditedBytes : undefined}
          onPrevImage={onPrevImage}
          onNextImage={onNextImage}
          viewingLine={viewingLine}
          viewingColumn={viewingColumn}
        />
      )}
    </div>
  )
}
