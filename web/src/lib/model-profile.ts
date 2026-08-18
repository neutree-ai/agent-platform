/**
 * Editing helpers for a provider's model profile.
 *
 * The form edits two of the profile's fields — the codex catalog and the
 * reasoning effort — but writes back the whole object, so everything else it
 * finds there (a wire_api override, a core added after this build) has to
 * survive the round trip untouched.
 */

import type { ModelProfile } from '@/lib/api/types'

interface CatalogParse {
  ok: boolean
  /** Slugs the catalog covers, for the summary line. */
  slugs: string[]
  /** Populated only when `ok` is false. */
  error?: string
}

/** Read the catalog text the way cp will, so the dialog reports the same verdict. */
export function parseCatalogText(text: string): CatalogParse {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, slugs: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    return { ok: false, slugs: [], error: (e as Error).message }
  }

  const models = (parsed as { models?: unknown })?.models
  if (!Array.isArray(models) || models.length === 0) {
    return { ok: false, slugs: [], error: 'Expected a { "models": [...] } object' }
  }

  const slugs: string[] = []
  for (const model of models) {
    const slug = (model as { slug?: unknown })?.slug
    if (typeof slug !== 'string' || !slug) {
      return { ok: false, slugs: [], error: 'Every model needs a slug' }
    }
    slugs.push(slug)
  }
  const dupe = slugs.find((s, i) => slugs.indexOf(s) !== i)
  if (dupe) return { ok: false, slugs: [], error: `Duplicate slug: ${dupe}` }

  return { ok: true, slugs }
}

/** The catalog as text for the editor, or '' when the provider declares none. */
export function catalogToText(profile: ModelProfile | null | undefined): string {
  const catalog = profile?.codex?.model_catalog
  return catalog ? JSON.stringify(catalog, null, 2) : ''
}

/**
 * Fold edited catalog + effort back into the stored profile.
 *
 * Returns null when nothing is left to declare, which is what clears the column.
 */
export function buildModelProfile(
  stored: ModelProfile | null | undefined,
  catalogText: string,
  reasoningEffort: string,
): ModelProfile | null {
  const codex: Record<string, unknown> = { ...(stored?.codex ?? {}) }

  const trimmed = catalogText.trim()
  if (trimmed) {
    codex.model_catalog = JSON.parse(trimmed)
  } else {
    // biome-ignore lint/performance/noDelete: undefined would stay in Object.keys() and the profile would never collapse back to null
    delete codex.model_catalog
  }

  if (reasoningEffort) {
    codex.reasoning_effort = reasoningEffort
  } else {
    // biome-ignore lint/performance/noDelete: undefined would stay in Object.keys() and the profile would never collapse back to null
    delete codex.reasoning_effort
  }

  const next: Record<string, unknown> = { ...(stored ?? {}) }
  if (Object.keys(codex).length > 0) {
    next.codex = codex
  } else {
    // biome-ignore lint/performance/noDelete: undefined would stay in Object.keys() and the profile would never collapse back to null
    delete next.codex
  }
  return Object.keys(next).length > 0 ? (next as ModelProfile) : null
}

/** The profile a half-edited form would save, for the provider Test probe. */
export function draftProfile(form: {
  model_profile: ModelProfile | null
  catalog_text: string
  reasoning_effort: string
}): ModelProfile | null | undefined {
  try {
    return buildModelProfile(form.model_profile, form.catalog_text, form.reasoning_effort)
  } catch {
    // Unparseable text: let the probe answer about the connection only, the
    // editor already shows what is wrong with the catalog.
    return undefined
  }
}
