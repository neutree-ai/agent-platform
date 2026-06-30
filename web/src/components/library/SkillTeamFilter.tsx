import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SkillTeamOption {
  id: string
  name: string
}

interface Props {
  /** Teams that currently have skills shared with the user. */
  teams: SkillTeamOption[]
  /** Selected team id, or `null` for "all teams". */
  value: string | null
  onChange: (next: string | null) => void
}

/**
 * Team filter for the skill library's "Shared with me" group. As shared
 * skills pile up across teams, this narrows the grid to a single team's
 * skills (matched on `shared_via_teams`). Filtering is client-side off the
 * already-loaded list, so picking a team also hides the owned groups — the
 * intended behavior, mirroring how the scope tabs collapse the view.
 *
 * Renders nothing when no team has shared anything (no value in offering a
 * one-option filter).
 */
export function SkillTeamFilter({ teams, value, onChange }: Props) {
  const { t } = useTranslation()
  if (teams.length === 0) return null
  const selected = value ? (teams.find((tm) => tm.id === value) ?? null) : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('components.library.skills.teamFilter.label')}
          className={cn(
            'h-7 max-w-[12rem] gap-1.5 rounded-full px-2.5 text-xs',
            selected && 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15',
          )}
        >
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {selected ? selected.name : t('components.library.skills.teamFilter.all')}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-48 overflow-y-auto">
        <DropdownMenuItem className="justify-between gap-2" onClick={() => onChange(null)}>
          {t('components.library.skills.teamFilter.all')}
          {!selected && <Check className="h-3 w-3 shrink-0" />}
        </DropdownMenuItem>
        {teams.map((tm) => (
          <DropdownMenuItem
            key={tm.id}
            className="justify-between gap-2"
            onClick={() => onChange(tm.id)}
          >
            <span className="truncate">{tm.name}</span>
            {selected?.id === tm.id && <Check className="h-3 w-3 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
