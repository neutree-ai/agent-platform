import type { SkillDependents } from '@/lib/api/types'
import { Box } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Occupancy preview shared by the delete + visibility-narrow flows. The
 * owner's own workspaces are listed by name (actionable — they can detach
 * them); other users' workspaces and template versions collapse to a count,
 * matching the backend which never exposes cross-user identities.
 */
export function SkillDependentsList({ data }: { data: SkillDependents }) {
  const { t } = useTranslation()
  const hasOwn = data.own_workspaces.length > 0
  const hasOther = data.other_workspace_count > 0
  const hasTemplates = data.template_version_count > 0

  if (!hasOwn && !hasOther && !hasTemplates) {
    return (
      <div className="text-xs text-muted-foreground">{t('components.skillDependents.none')}</div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      {hasOwn && (
        <div className="space-y-1">
          <div className="font-medium text-foreground">
            {t('components.skillDependents.ownTitle')}
          </div>
          <ul className="space-y-1">
            {data.own_workspaces.map((w) => (
              <li
                key={w.id}
                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1"
              >
                <Box className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{w.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasOther && (
        <div className="text-muted-foreground">
          {t('components.skillDependents.otherCount', { count: data.other_workspace_count })}
        </div>
      )}
      {hasTemplates && (
        <div className="text-muted-foreground">
          {t('components.skillDependents.templateCount', { count: data.template_version_count })}
        </div>
      )}
    </div>
  )
}
