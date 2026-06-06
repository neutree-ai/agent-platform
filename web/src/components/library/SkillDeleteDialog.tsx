import { SkillDependentsList } from '@/components/library/SkillDependentsList'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useSkillDependents } from '@/hooks/useSkills'
import type { ApiSkill } from '@/lib/api/types'
import { useTranslation } from 'react-i18next'

interface SkillDeleteDialogProps {
  skill: ApiSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string) => void
  pending: boolean
}

/**
 * Pre-delete occupancy preview. Fetches dependents when opened so the owner
 * sees exactly which of their workspaces to detach before the skill can go.
 * Deletion is gated client-side when anything still references the skill —
 * the backend would 409 anyway (FK RESTRICT), so we surface that up front.
 */
export function SkillDeleteDialog({
  skill,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: SkillDeleteDialogProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useSkillDependents(skill?.id, open)

  if (!skill) return null

  // Split the blockers by who can act on them. Own workspaces are actionable —
  // the owner can detach them. External mounts (other users' workspaces) and
  // template versions are not: the owner has no access to remove them, so the
  // copy must not tell them to "remove it from the workspaces below".
  const hasOwn = !!data && data.own_workspaces.length > 0
  const hasExternal = !!data && (data.other_workspace_count > 0 || data.template_version_count > 0)
  const blocked = hasOwn || hasExternal

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('components.library.skills.deleteDialog.title', { name: skill.name })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" className="h-3 w-3" />
              {t('components.skillDependents.loading')}
            </div>
          ) : (
            <>
              {data && <SkillDependentsList data={data} />}
              <div className="text-xs text-muted-foreground">
                {blocked
                  ? hasExternal
                    ? t('components.library.skills.deleteDialog.blockedExternal')
                    : t('components.library.skills.deleteDialog.blockedOwn')
                  : t('components.library.skills.deleteDialog.clear')}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isLoading || blocked || pending}
              onClick={() => onConfirm(skill.id)}
            >
              {pending
                ? t('components.library.skills.deleteDialog.deleting')
                : t('components.library.skills.deleteDialog.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
