import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api/client'
import type { ApiShare } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { copyToClipboard } from '@/lib/utils'
import { Check, Copy, ExternalLink, Pencil, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShareSessionButtonProps {
  workspaceId: string
  sessionId: string
  /** When provided, the trigger button is hidden and the dialog is controlled externally. */
  controlled?: { open: boolean; onOpenChange: (open: boolean) => void }
}

function ShareRow({
  share,
  copiedId,
  onCopy,
  onDelete,
  onRename,
}: {
  share: ApiShare
  copiedId: string | null
  onCopy: (share: ApiShare) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(share.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== share.title) {
      onRename(share.id, trimmed)
    } else {
      setDraft(share.title)
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-2 rounded border border-border p-2 text-xs">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (isCommitEnter(e)) commitRename()
              if (e.key === 'Escape') {
                setDraft(share.title)
                setEditing(false)
              }
            }}
            className="h-6 text-xs px-1.5"
          />
        ) : (
          <div
            className="truncate font-medium cursor-pointer hover:text-primary"
            onClick={() => {
              setDraft(share.title)
              setEditing(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setDraft(share.title)
                setEditing(true)
              }
            }}
            // biome-ignore lint/a11y/useSemanticElements: title-truncation div inside flex row, swap to <button> would shift layout
            role="button"
            tabIndex={0}
          >
            {share.title || t('components.shareSession.untitled')}
          </div>
        )}
        <div className="text-mini text-muted-foreground mt-0.5">
          {new Date(share.created_at).toLocaleString()}
        </div>
      </div>
      {!editing && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setDraft(share.title)
                  setEditing(true)
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('components.shareSession.actions.rename')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onCopy(share)}
              >
                {copiedId === share.id ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('components.shareSession.actions.copyLink')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => window.open(share.url, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('components.shareSession.actions.openInNewTab')}</TooltipContent>
          </Tooltip>
          <ConfirmButton
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onConfirm={() => onDelete(share.id)}
            tooltip={t('components.shareSession.actions.deleteShare')}
          />
        </>
      )}
    </div>
  )
}

export function ShareSessionButton({
  workspaceId,
  sessionId,
  controlled,
}: ShareSessionButtonProps) {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlled ? controlled.open : internalOpen
  const setOpen = controlled ? controlled.onOpenChange : setInternalOpen
  const [shares, setShares] = useState<ApiShare[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadShares = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.getSessionShares(workspaceId, sessionId)
      setShares(list)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [workspaceId, sessionId])

  useEffect(() => {
    if (open) {
      setError(null)
      loadShares()
    }
  }, [open, loadShares])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const share = await api.createShare(workspaceId, sessionId, newTitle.trim() || undefined)
      setShares((prev) => [share, ...prev])
      setNewTitle('')
    } catch (e: any) {
      setError(e?.message || t('components.shareSession.errors.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteShare(id)
      setShares((prev) => prev.filter((s) => s.id !== id))
    } catch {
      // ignore
    }
  }

  const handleRename = async (id: string, title: string) => {
    try {
      await api.updateShare(id, title)
      setShares((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
    } catch {
      // ignore
    }
  }

  const handleCopy = async (share: ApiShare) => {
    const url = `${window.location.origin}${share.url}`
    await copyToClipboard(url)
    setCopiedId(share.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <AppHeaderButton icon={Share2} label={t('components.shareSession.trigger')} />
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.shareSession.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('components.shareSession.placeholders.title')}
              className="text-xs"
              onKeyDown={(e) => {
                if (isCommitEnter(e) && !creating) handleCreate()
              }}
            />
            <Button onClick={handleCreate} disabled={creating} size="sm" className="shrink-0">
              {creating ? <Spinner size="sm" className="mr-2" /> : null}
              {t('common.create')}
            </Button>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
          )}

          {loading && shares.length === 0 && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}

          {shares.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t('components.shareSession.sections.existingShares')}
              </div>
              {shares.map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
