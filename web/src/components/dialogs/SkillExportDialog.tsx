/**
 * Export a skill to local agents.
 *
 * Mints capability URLs that `npx skills add <url>` installs from, via the
 * Agent Skills `.well-known` discovery protocol. Distinct from
 * `SkillShareDialog`, which governs who inside the platform can see the
 * skill — this one hands it to anything holding the URL, with no login.
 *
 * The two are deliberately separate surfaces rather than tabs of one dialog:
 * SkillShareDialog defers everything to a Save button, while minting and
 * revoking here take effect immediately. Mixing the two save models would
 * make "Cancel" a lie about credentials that already exist.
 */
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  useCreateSkillExport,
  useRevokeSkillExport,
  useSkillExports,
} from '@/hooks/useSkillExports'
import type { ApiSkill, ApiSkillExport } from '@/lib/api/types'
import { MAX_SKILL_SLUG_LENGTH, deriveSkillSlug, isValidSkillSlug } from '@neutree-ai/types'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Sentinel for the TTL select — never sent as a value. Mirrors PublicLinkDialog. */
const PERMANENT = 'permanent'

/**
 * Longer than the file-export ladder (minutes/hours) because these live on a
 * developer's machine and get re-fetched over weeks, not during one session.
 */
const TTL_OPTIONS = [
  { value: '7', labelKey: '7days' },
  { value: '30', labelKey: '30days' },
  { value: '90', labelKey: '90days' },
  { value: PERMANENT, labelKey: 'permanent' },
] as const

const DEFAULT_TTL = '90'

interface SkillExportDialogProps {
  skill: ApiSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The command a user actually pastes — copying the bare URL helps less. */
function installCommand(url: string): string {
  return `npx skills add ${url}`
}

export function SkillExportDialog({ skill, open, onOpenChange }: SkillExportDialogProps) {
  const { t, i18n } = useTranslation()
  const k = 'components.library.skills.exportDialog'

  const { data: exports, isLoading } = useSkillExports(skill?.id ?? null, open)
  const createExport = useCreateSkillExport(skill?.id ?? '')
  const revokeExport = useRevokeSkillExport(skill?.id ?? '')

  const [slug, setSlug] = useState('')
  const [ttl, setTtl] = useState(DEFAULT_TTL)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<ApiSkillExport | null>(null)

  // Derived locally so a name we can't slugify surfaces as an empty, focused
  // field instead of a 400 after the user commits.
  const derivedSlug = useMemo(() => (skill ? deriveSkillSlug(skill.name) : null), [skill])

  useEffect(() => {
    if (open) {
      setSlug(derivedSlug ?? '')
      setTtl(DEFAULT_TTL)
      setError(null)
      setFresh(null)
    }
  }, [open, derivedSlug])

  const isPermanent = ttl === PERMANENT
  const slugValid = isValidSkillSlug(slug)
  const canSubmit = slugValid && !createExport.isPending

  const handleCreate = async () => {
    setError(null)
    try {
      const created = await createExport.mutateAsync({
        slug,
        ttl_days: isPermanent ? null : Number(ttl),
      })
      setFresh(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRevoke = (token: string) => {
    revokeExport.mutate(token, {
      onSuccess: () => {
        if (fresh?.token === token) setFresh(null)
        toast.success(t(`${k}.toasts.revoked`))
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : t(`${k}.errors.revokeFailed`)),
    })
  }

  const formatExpiry = (value: string | null) =>
    value === null
      ? t(`${k}.expiresNever`)
      : t(`${k}.expiresAt`, { value: new Date(value).toLocaleString(i18n.language) })

  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`${k}.title`)}</DialogTitle>
          <DialogDescription>{t(`${k}.description`, { name: skill.name })}</DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {isPermanent ? t(`${k}.warningPermanent`) : t(`${k}.warning`)}
          </AlertDescription>
        </Alert>

        {/* Freshly minted link. Shown as the full command because that is what
            gets pasted into a terminal; the list below only offers copy. */}
        {fresh && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3">
            <Label className="text-xs text-muted-foreground">{t(`${k}.newLinkLabel`)}</Label>
            <div className="flex items-center gap-1">
              <Input
                readOnly
                value={installCommand(fresh.url)}
                className="flex-1 font-mono text-xs"
              />
              <CopyButton value={installCommand(fresh.url)} />
            </div>
            <p className="text-xs text-muted-foreground">{formatExpiry(fresh.expires_at)}</p>
          </div>
        )}

        {/* Existing links. No URL text by design — the row offers copy and
            revoke; showing live credentials in a list invites shoulder-surfing
            and screenshots. */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t(`${k}.existingLabel`)}</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t(`${k}.loading`)}
            </div>
          ) : !exports || exports.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">{t(`${k}.empty`)}</p>
          ) : (
            <ScrollArea className="max-h-44">
              <div className="space-y-1 pr-2">
                {exports.map((e) => (
                  <div
                    key={e.token}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{e.slug}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatExpiry(e.expires_at)}
                        {' · '}
                        {e.last_used_at
                          ? t(`${k}.lastUsed`, {
                              value: new Date(e.last_used_at).toLocaleString(i18n.language),
                            })
                          : t(`${k}.neverUsed`)}
                      </div>
                    </div>
                    <CopyButton value={installCommand(e.url)} />
                    <ConfirmButton
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onConfirm={() => handleRevoke(e.token)}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      tooltip={t(`${k}.revoke`)}
                      confirmLabel={t(`${k}.revokeConfirm`)}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Mint a new one. */}
        <div className="space-y-3 border-t border-border/60 pt-3">
          <div className="space-y-1">
            <Label htmlFor="export-slug" className="text-xs text-muted-foreground">
              {t(`${k}.slugLabel`)}
            </Label>
            <Input
              id="export-slug"
              value={slug}
              onChange={(ev) => setSlug(ev.target.value)}
              // A name with nothing latin in it leaves this empty, so send the
              // user straight to the field they have to fill in.
              autoFocus={!derivedSlug}
              className="font-mono text-xs"
              placeholder={t(`${k}.slugPlaceholder`)}
            />
            <p className="text-xs text-muted-foreground">
              {slug && !slugValid ? (
                <span className="text-destructive">
                  {t(`${k}.slugInvalid`, { max: MAX_SKILL_SLUG_LENGTH })}
                </span>
              ) : (
                t(`${k}.slugHint`)
              )}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="export-ttl" className="text-xs text-muted-foreground">
              {t(`${k}.ttlLabel`)}
            </Label>
            <Select value={ttl} onValueChange={setTtl} disabled={createExport.isPending}>
              <SelectTrigger id="export-ttl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(`${k}.ttlOptions.${opt.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="break-all">{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {createExport.isPending ? t(`${k}.creating`) : t(`${k}.create`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
