import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isCommitEnter } from '@/lib/keyboard'
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Link as LinkIcon,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DufsEntry {
  name: string
  path_type: 'Dir' | 'File' | 'SymLink' | 'SymlinkDir'
  mtime: number
  size: number
}

export function isDir(entry: DufsEntry): boolean {
  return entry.path_type === 'Dir' || entry.path_type === 'SymlinkDir'
}

// ---------------------------------------------------------------------------
// FileEntryMenu — the ⋯ dropdown shown on hover for each file/folder entry
// ---------------------------------------------------------------------------

interface FileEntryMenuProps {
  entry: DufsEntry
  downloadUrl?: string
  onRename?: () => void
  onDelete?: () => void
  /** Show "New file" option (for directories). */
  onNewFile?: () => void
  /** Show "New folder" option (for directories). */
  onNewFolder?: () => void
  /**
   * Show "Create public link" option — opens a dialog that mints a short-lived
   * public URL (anyone with the link can read the file, no auth required).
   */
  onCreatePublicLink?: () => void
  /**
   * Show "Add to chat" option — inserts an `@file/` reference to this entry at
   * the chat composer's caret.
   */
  onAddToChat?: () => void
}

export function FileEntryMenu({
  entry,
  downloadUrl,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCreatePublicLink,
  onAddToChat,
}: FileEntryMenuProps) {
  const { t } = useTranslation()
  const hasCreateActions = onNewFile || onNewFolder
  // Two-click confirm on Delete: first click arms (menu stays open, item flips
  // to a destructive "click again" state); second click within 3s fires.
  const [deleteArmed, setDeleteArmed] = useState(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(deleteTimerRef.current), [])
  // When "Add to chat" is picked, the chat composer claims focus itself — so
  // suppress Radix's default "restore focus to the trigger" on close, which
  // would otherwise win the race and pull focus back into the file browser.
  const addToChatPickedRef = useRef(false)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setDeleteArmed(false)
          clearTimeout(deleteTimerRef.current)
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(e) => {
          if (addToChatPickedRef.current) {
            addToChatPickedRef.current = false
            e.preventDefault()
          }
        }}
      >
        {onAddToChat && (
          <DropdownMenuItem
            onSelect={() => {
              addToChatPickedRef.current = true
              onAddToChat()
            }}
          >
            <MessageSquarePlus />
            {t('components.fileOperations.actions.addToChat')}
          </DropdownMenuItem>
        )}
        {onAddToChat &&
          (onNewFile ||
            onNewFolder ||
            onCreatePublicLink ||
            downloadUrl ||
            onRename ||
            onDelete) && <DropdownMenuSeparator />}
        {onNewFile && (
          <DropdownMenuItem onSelect={onNewFile}>
            <FilePlus />
            {t('components.fileOperations.actions.newFile')}
          </DropdownMenuItem>
        )}
        {onNewFolder && (
          <DropdownMenuItem onSelect={onNewFolder}>
            <FolderPlus />
            {t('components.fileOperations.actions.newFolder')}
          </DropdownMenuItem>
        )}
        {hasCreateActions && (onCreatePublicLink || downloadUrl || onRename || onDelete) && (
          <DropdownMenuSeparator />
        )}
        {onCreatePublicLink && (
          <DropdownMenuItem onSelect={onCreatePublicLink}>
            <LinkIcon />
            {t('components.fileOperations.actions.createPublicLink')}
          </DropdownMenuItem>
        )}
        {downloadUrl && (
          <DropdownMenuItem asChild>
            <a href={downloadUrl} download={isDir(entry) ? `${entry.name}.zip` : entry.name}>
              <Download />
              {isDir(entry)
                ? t('components.fileOperations.actions.downloadZip')
                : t('components.fileOperations.actions.download')}
            </a>
          </DropdownMenuItem>
        )}
        {onRename && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            {t('components.fileOperations.actions.rename')}
          </DropdownMenuItem>
        )}
        {(downloadUrl || onRename) && onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem
            onSelect={(e) => {
              if (!deleteArmed) {
                // Keep the menu open so the user sees the armed state and the
                // confirm label, then can click again to actually delete.
                e.preventDefault()
                setDeleteArmed(true)
                clearTimeout(deleteTimerRef.current)
                deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), 3000)
              } else {
                clearTimeout(deleteTimerRef.current)
                setDeleteArmed(false)
                onDelete()
              }
            }}
            className={
              deleteArmed
                ? 'bg-destructive/10 text-destructive font-medium focus:bg-destructive/15 focus:text-destructive'
                : 'text-destructive focus:bg-destructive/10 focus:text-destructive'
            }
          >
            <Trash2 />
            {deleteArmed
              ? t('components.fileOperations.actions.deleteConfirm')
              : t('components.fileOperations.actions.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// RenameDialog
// ---------------------------------------------------------------------------

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
  onRename: (newName: string) => void
}

export function RenameDialog({ open, onOpenChange, currentName, onRename }: RenameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(currentName)

  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  const submit = () => {
    if (name.trim()) onRename(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.fileOperations.dialogs.rename.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) submit()
          }}
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit}>
            {t('components.fileOperations.actions.rename')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// NewFolderDialog
// ---------------------------------------------------------------------------

interface NewFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}

export function NewFolderDialog({ open, onOpenChange, onSubmit }: NewFolderDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const submit = () => {
    if (name.trim()) onSubmit(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.fileOperations.dialogs.newFolder.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={t('components.fileOperations.dialogs.newFolder.placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) submit()
          }}
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface NewFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}

// ---------------------------------------------------------------------------
// PublicLinkDialog — mint a short-lived public URL for a workspace file.
// Anyone with the link can read the file without auth; warn the user, let
// them pick a TTL, and surface the resulting URL with copy / open actions.
// ---------------------------------------------------------------------------

interface PublicLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string | null
  /** When the target is a folder, the link downloads it as a zip archive. */
  isDir?: boolean
  onGenerate: (opts: {
    ttlSeconds?: number
    permanent?: boolean
  }) => Promise<{ url: string; expires_at: string | null }>
}

// `permanent` is a sentinel selector value — never sent to the backend.
const PERMANENT = 'permanent'
const TTL_OPTIONS = [
  { value: '300', labelKey: '5min' },
  { value: '1800', labelKey: '30min' },
  { value: '3600', labelKey: '1hour' },
  { value: PERMANENT, labelKey: 'permanent' },
] as const

export function PublicLinkDialog({
  open,
  onOpenChange,
  filePath,
  isDir = false,
  onGenerate,
}: PublicLinkDialogProps) {
  const { t, i18n } = useTranslation()
  const [ttl, setTtl] = useState('3600')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ url: string; expires_at: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTtl('3600')
      setResult(null)
      setError(null)
      setGenerating(false)
    }
  }, [open])

  const isPermanent = ttl === PERMANENT

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const r = isPermanent
        ? await onGenerate({ permanent: true })
        : await onGenerate({ ttlSeconds: Number(ttl) })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const expiresAtFormatted = result?.expires_at
    ? new Date(result.expires_at).toLocaleString(i18n.language)
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.fileOperations.dialogs.publicLink.title')}</DialogTitle>
          <DialogDescription>
            {t('components.fileOperations.dialogs.publicLink.description')}
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {isPermanent
              ? t('components.fileOperations.dialogs.publicLink.warningPermanent')
              : t('components.fileOperations.dialogs.publicLink.warning')}
          </AlertDescription>
        </Alert>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {isDir
              ? t('components.fileOperations.dialogs.publicLink.folderLabel')
              : t('components.fileOperations.dialogs.publicLink.fileLabel')}
          </Label>
          <div className="font-mono text-xs break-all rounded bg-muted/40 px-2 py-1.5">
            {filePath}
          </div>
          {isDir && (
            <p className="text-xs text-muted-foreground">
              {t('components.fileOperations.dialogs.publicLink.folderNote')}
            </p>
          )}
        </div>

        {!result && (
          <div className="space-y-1">
            <Label htmlFor="ttl-select" className="text-xs text-muted-foreground">
              {t('components.fileOperations.dialogs.publicLink.ttlLabel')}
            </Label>
            <Select value={ttl} onValueChange={setTtl} disabled={generating}>
              <SelectTrigger id="ttl-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(`components.fileOperations.dialogs.publicLink.ttlOptions.${opt.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="break-all">{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              {t('components.fileOperations.dialogs.publicLink.linkLabel')}
            </Label>
            <div className="flex items-center gap-1">
              <Input readOnly value={result.url} className="font-mono text-xs flex-1" />
              <CopyButton value={result.url} />
            </div>
            <div className="text-xs text-muted-foreground">
              {result.expires_at == null
                ? t('components.fileOperations.dialogs.publicLink.expiresNever')
                : t('components.fileOperations.dialogs.publicLink.expiresAt', {
                    value: expiresAtFormatted,
                  })}
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3 w-3" />
                  {t('components.fileOperations.dialogs.publicLink.openLink')}
                </a>
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={generating}
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={generating || !filePath}>
                {generating
                  ? t('components.fileOperations.dialogs.publicLink.generating')
                  : t('components.fileOperations.dialogs.publicLink.generate')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ManagePublicLinksDialog — list active public file URLs for a workspace and
// let the owner revoke (hard-delete) them. Surfaces permanent links here so
// users can audit / kill them without losing track. Empty state is OK — the
// user simply hasn't minted any yet.
// ---------------------------------------------------------------------------

interface PublicLinkRecord {
  token: string
  path: string
  url: string
  created_at: string
  /** `null` when the URL is permanent (no expiry). */
  expires_at: string | null
}

interface ManagePublicLinksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  load: () => Promise<PublicLinkRecord[]>
  onRevoke: (token: string) => Promise<void>
}

export function ManagePublicLinksDialog({
  open,
  onOpenChange,
  load,
  onRevoke,
}: ManagePublicLinksDialogProps) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<PublicLinkRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyToken, setBusyToken] = useState<string | null>(null)

  const refresh = async () => {
    setError(null)
    try {
      setItems(await load())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (open) {
      setItems(null)
      setError(null)
      setBusyToken(null)
      refresh()
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: refresh closes over stable props
  }, [open])

  const handleRevoke = async (token: string) => {
    setBusyToken(token)
    setError(null)
    try {
      await onRevoke(token)
      setItems((prev) => prev?.filter((r) => r.token !== token) ?? prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyToken(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t('components.fileOperations.dialogs.managePublicLinks.title')}
          </DialogTitle>
          <DialogDescription>
            {t('components.fileOperations.dialogs.managePublicLinks.description')}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="break-all">{error}</AlertDescription>
          </Alert>
        )}

        {items == null && !error ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('components.fileOperations.dialogs.managePublicLinks.loading')}
          </div>
        ) : items && items.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t('components.fileOperations.dialogs.managePublicLinks.empty')}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {items?.map((r) => (
              <div key={r.token} className="rounded border border-border p-2 space-y-1.5">
                <div className="font-mono text-xs break-all">{r.path}</div>
                <div className="flex items-center gap-1">
                  <Input readOnly value={r.url} className="font-mono text-[11px] flex-1 h-7" />
                  <CopyButton value={r.url} />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {r.expires_at == null
                      ? t('components.fileOperations.dialogs.managePublicLinks.permanent')
                      : t('components.fileOperations.dialogs.managePublicLinks.expiresAt', {
                          value: new Date(r.expires_at).toLocaleString(i18n.language),
                        })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-destructive hover:text-destructive"
                    onClick={() => handleRevoke(r.token)}
                    disabled={busyToken === r.token}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    {busyToken === r.token
                      ? t('components.fileOperations.dialogs.managePublicLinks.revoking')
                      : t('components.fileOperations.dialogs.managePublicLinks.revoke')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// NewFileDialog
// ---------------------------------------------------------------------------

export function NewFileDialog({ open, onOpenChange, onSubmit }: NewFileDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const submit = () => {
    if (name.trim()) onSubmit(name.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('components.fileOperations.dialogs.newFile.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={t('components.fileOperations.dialogs.newFile.placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isCommitEnter(e)) submit()
          }}
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
