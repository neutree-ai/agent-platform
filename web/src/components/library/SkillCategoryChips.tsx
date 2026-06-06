import {
  SKILL_CATEGORY_CHIPS,
  type SkillCategoryChip,
  UNCATEGORIZED_SENTINEL,
  categoryI18nKey,
} from '@/lib/skill-categories'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface Props {
  selected: ReadonlySet<SkillCategoryChip>
  onToggle: (chip: SkillCategoryChip) => void
}

/**
 * Multi-select chip row for skill category. Chips are a stable hard-coded
 * set (see `lib/skill-categories.ts`); the data may carry other historical
 * values, which the user can't filter by from here. The Uncategorized chip
 * uses the server's `"uncategorized"` sentinel.
 *
 * Counts are intentionally omitted — they required an extra unfiltered
 * fetch and the value didn't justify the moving parts. Add back later if
 * the chip set grows past what's scannable at a glance.
 */
export function SkillCategoryChips({ selected, onToggle }: Props) {
  const { t } = useTranslation()
  return (
    <fieldset
      aria-label={t('components.library.skills.categories.title')}
      className="flex flex-wrap items-center gap-1.5 border-0 p-0"
    >
      {SKILL_CATEGORY_CHIPS.map((chip) => {
        const isSelected = selected.has(chip)
        const isUncategorized = chip === UNCATEGORIZED_SENTINEL
        return (
          <button
            key={chip}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(chip)}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              isSelected
                ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                : 'border-border bg-card text-foreground/80 hover:border-foreground/20 hover:text-foreground',
              isUncategorized && !isSelected && 'text-muted-foreground',
            )}
          >
            {t(categoryI18nKey(chip))}
          </button>
        )
      })}
    </fieldset>
  )
}
