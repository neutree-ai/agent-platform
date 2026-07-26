/**
 * Slug rules for the Agent Skills discovery protocol.
 *
 * A published skill is addressed by a `name` that the `npx skills` client
 * validates as `^[a-z0-9-]+$`, 1–64 chars, with no leading, trailing, or
 * consecutive hyphens. Entries failing any of those are *silently skipped* —
 * a bad slug produces an empty skill list, not an error — so validation has
 * to happen on our side, at mint time, where we can still tell the user.
 *
 * The slug also names the directory the client creates on disk, which is why
 * it is stored on the export rather than derived per request: renaming the
 * skill afterwards would otherwise silently retarget the install.
 */

export const MAX_SKILL_SLUG_LENGTH = 64

/** The client's own validation, mirrored exactly. */
export function isValidSkillSlug(slug: string): boolean {
  return (
    slug.length >= 1 &&
    slug.length <= MAX_SKILL_SLUG_LENGTH &&
    /^[a-z0-9-]+$/.test(slug) &&
    !slug.startsWith('-') &&
    !slug.endsWith('-') &&
    !slug.includes('--')
  )
}

/**
 * Best-effort projection of a free-form skill name into a valid slug.
 *
 * Returns null when nothing usable survives — an all-CJK name ("术语检查"),
 * pure punctuation, emoji. Callers must then ask the user for one instead of
 * inventing an opaque id-derived name they'd have to live with on disk.
 */
export function deriveSkillSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_SLUG_LENGTH)
    // Truncation can land on a separator, which would be a trailing hyphen.
    .replace(/-+$/g, '')
  return isValidSkillSlug(slug) ? slug : null
}
