/**
 * Skill categories shown as multi-select chips at the top of the skills library.
 *
 * Intentionally a small stable set — see CLAUDE/PR notes. The list is hard-coded
 * in the UI (not derived from data) so adding/removing a chip is a code change
 * with i18n and reasoning attached. Server stores `category` as free-form TEXT;
 * if a chip is retired its old values still live in the DB and can be migrated
 * by hand.
 *
 * The literal `"uncategorized"` is a sentinel: the server treats it as
 * `category IS NULL`. A skill with `category === null` will match the
 * Uncategorized chip; a skill that literally typed `"uncategorized"` would be
 * indistinguishable in this UI, which is fine — we don't offer the literal
 * value as a regular chip.
 */
export const SKILL_CATEGORY_VALUES = [
  'coding',
  'writing',
  'research',
  'data',
  'ops',
  'design',
  'review',
  'other',
] as const

// Note: a `(typeof SKILL_CATEGORY_VALUES)[number]` type is available if a
// future caller needs the value-only union; derive it inline rather than
// exporting an unused public type from this module.

/** Server-recognized sentinel for "category IS NULL". */
export const UNCATEGORIZED_SENTINEL = 'uncategorized'

/** All chip values shown, including the uncategorized sentinel. */
export const SKILL_CATEGORY_CHIPS = [...SKILL_CATEGORY_VALUES, UNCATEGORIZED_SENTINEL] as const

export type SkillCategoryChip = (typeof SKILL_CATEGORY_CHIPS)[number]

/** i18n key for a chip label. Lives under `components.library.skills.categories`. */
export function categoryI18nKey(chip: SkillCategoryChip): string {
  return `components.library.skills.categories.${chip}`
}
