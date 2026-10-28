import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
  AFS_FOLDER_NAME_RE,
  type AfsAvailableShare,
  type AfsPermission,
  listAvailableAfsShares,
  mountAfsShare,
} from '@/lib/api/agent-files'
import { cn } from '@/lib/utils'
import { Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AfsPermissionSelect, afsPermissionKey } from './AfsPermissionSelect'

interface MountTeamShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onMounted?: () => void
}

/** Mount another user's folder shared with one of your teams. */
export function MountTeamShareDialog({
  open,
  onOpenChange,
  workspaceId,
  onMounted,
}: MountTeamShareDialogProps) {
  const { t } = useTranslation()
  const [shares, setShares] = useState<AfsAvailableShare[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<AfsAvailableShare | null>(null)
  const [permission, setPermission] = useState<AfsPermission>('read_only')
  const [mountName, setMountName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelected(null)
      setError(null)
      setSubmitting(false)
      return
    }
    setLoading(true)
    listAvailableAfsShares(workspaceId)
      .then(setShares)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open, workspaceId])

  function select(share: AfsAvailableShare) {
    setSelected(share)
    setPermission('read_only')
    setMountName(share.name)
    setError(null)
  }

  async function handleMount() {
    if (!selected) return
    if (!AFS_FOLDER_NAME_RE.test(mountName)) {
      setError(t('components.afsShares.newDialog.invalidName'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await mountAfsShare(workspaceId, selected.id, permission, mountName)
      onMounted?.()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('components.afsShares.mountDialog.title')}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </div>
        ) : shares.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('components.afsShares.mountDialog.empty')}
          </p>
        ) : (
          <div className="space-y-4">
            <ScrollArea className="max-h-56 rounded-md border border-border">
              <div className="divide-y divide-foreground/[0.05]">
                {shares.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => select(s)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/[0.04]',
                      selected?.id === s.id && 'bg-primary/[0.08]',
                    )}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-chart-1" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t('components.afsShares.mountDialog.from', {
                          owner: s.owner_display_name,
                          teams: s.team_names.join(', '),
                        })}
                      </div>
                    </div>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                      {t(afsPermissionKey(s.ceiling))}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>

            {selected && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mount-name">
                    {t('components.afsShares.mountDialog.mountNameLabel')}
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-muted-foreground">/mnt/afs/</span>
                    <Input
                      id="mount-name"
                      value={mountName}
                      onChange={(e) => setMountName(e.target.value)}
                      className="h-8 font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('components.afsShares.newDialog.nameHint')}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('components.afsShares.mountDialog.permissionLabel')}</Label>
                  <AfsPermissionSelect
                    value={permission}
                    onChange={setPermission}
                    max={selected.ceiling}
                    className="h-8 w-28"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleMount} disabled={submitting || !selected || !mountName}>
            {submitting
              ? t('components.afsShares.mountDialog.mounting')
              : t('components.afsShares.mountDialog.mount')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
