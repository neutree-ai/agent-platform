import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import { Check, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SkillPreviewCandidate {
  subpath: string
  name: string | null
  description: string | null
  fileCount: number
  // Defensively typed as optional — defends against an older scs that
  // hasn't shipped commit 0196083 yet. UI degrades to "no files / no body"
  // copy instead of crashing on `undefined.map`.
  files?: Array<{ path: string; size: number }>
  skillMd?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: SkillPreviewCandidate | null
  /**
   * "Use this skill" button — `null` to hide the button entirely (e.g.
   * read-only preview after import). Otherwise called with the candidate's
   * subpath when the user confirms.
   */
  onPick?: (subpath: string) => void
  /** Whether this candidate is the currently-picked one in the parent form. */
  isPicked?: boolean
}

/**
 * Read-only preview of one skill candidate inside the import dialog: file
 * manifest on the left, SKILL.md rendered on the right. Data comes from the
 * scan-preview / scan-tarball response so no extra round-trip is needed
 * when the user opens this.
 */
export function SkillPreviewDialog({ open, onOpenChange, candidate, onPick, isPicked }: Props) {
  const { t } = useTranslation()
  if (!candidate) return null
  const titleText = candidate.name ?? candidate.subpath ?? '/'
  const files = candidate.files ?? []
  const skillMd = candidate.skillMd ?? null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[80vh] flex-col gap-0 p-0',
          // Wider than the default — preview needs room for both columns.
          'sm:max-w-3xl md:max-w-4xl',
        )}
      >
        <DialogHeader className="space-y-1 border-b border-foreground/[0.06] px-5 py-4">
          <DialogTitle className="text-base">{titleText}</DialogTitle>
          <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
            <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px]">
              {candidate.subpath || '/'}
            </code>
            {candidate.description && <span>{candidate.description}</span>}
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[14rem_1fr]">
          {/* File list (mobile: collapsed above; md+: left column) */}
          <aside className="flex min-h-0 flex-col border-b border-foreground/[0.06] md:border-b-0 md:border-r">
            <div className="border-b border-foreground/[0.06] px-4 py-2 text-xs font-medium text-muted-foreground">
              {t('components.library.skills.preview.files', { count: candidate.fileCount })}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-xs">
              {files.length === 0 && (
                <li className="px-2 py-1 text-muted-foreground">
                  {t('components.library.skills.preview.noFiles')}
                </li>
              )}
              {files.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-foreground/[0.03]"
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                    {formatBytes(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          </aside>

          {/* SKILL.md body */}
          <section className="min-h-0 overflow-y-auto px-5 py-4">
            {skillMd ? (
              <Markdown className="prose-sm">{skillMd}</Markdown>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t('components.library.skills.preview.noSkillMd')}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-foreground/[0.06] px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {onPick && (
            <Button
              type="button"
              size="sm"
              variant={isPicked ? 'outline' : 'default'}
              onClick={() => {
                onPick(candidate.subpath)
                onOpenChange(false)
              }}
            >
              {isPicked ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  {t('components.library.skills.preview.picked')}
                </>
              ) : (
                t('components.library.skills.preview.useThis')
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
