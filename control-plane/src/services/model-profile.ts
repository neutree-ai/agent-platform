/**
 * Validation for a provider's model profile.
 *
 * A codex model catalog is not advisory: codex refuses to start when the file
 * fails to parse, so an unchecked profile turns "this provider is misconfigured"
 * into "this workspace never comes up". This is the gate that keeps a bad
 * catalog out of the database; the agent has a second one that keeps a catalog
 * cp accepted but a newer codex rejects from taking the pod down with it.
 *
 * The checks stop at the shape cp itself acts on. Copying codex's full model
 * descriptor schema here would make every codex release that adds a field
 * reject profiles that work — the agent's fallback covers that half.
 */

import { type ModelProfile, ModelProfileSchema } from '../../../internal/types/api'

/** Serialized ceiling for one profile. DeepSeek's official catalog is ~76KB. */
const MAX_PROFILE_BYTES = 1024 * 1024

type ModelProfileCheck = { ok: true; profile: ModelProfile | null } | { ok: false; error: string }

/**
 * Validate a profile submitted by a client.
 *
 * `undefined` means the caller did not touch the profile; `null` clears it.
 * Both are accepted and reported as a null profile, so callers can pass the
 * result straight through to the store.
 */
export function checkModelProfile(raw: unknown): ModelProfileCheck {
  if (raw === undefined || raw === null) return { ok: true, profile: null }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'model_profile must be an object' }
  }

  const size = Buffer.byteLength(JSON.stringify(raw), 'utf8')
  if (size > MAX_PROFILE_BYTES) {
    return {
      ok: false,
      error: `model_profile is ${Math.round(size / 1024)}KB, over the ${MAX_PROFILE_BYTES / 1024}KB limit`,
    }
  }

  const parsed = ModelProfileSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.')
    return { ok: false, error: path ? `${path}: ${first?.message}` : (first?.message ?? 'invalid') }
  }

  const codex = parsed.data.codex
  if (codex) {
    const catalog = codex.model_catalog
    if (catalog) {
      const slugs = catalog.models.map((m) => m.slug)
      const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
      if (dupes.length > 0) {
        return {
          ok: false,
          error: `model_catalog lists ${dupes[0]} more than once; codex matches a model by slug`,
        }
      }
    }

    // Reasoning effort is checked against the union of what the catalog
    // declares, not per model: the provider serves several models and the
    // workspace picks one later. The agent narrows it to the model actually in
    // use and drops the setting when that model doesn't declare the level.
    if (codex.reasoning_effort && catalog) {
      const declared = new Set<string>()
      for (const model of catalog.models) {
        const levels = (model as { supported_reasoning_levels?: unknown })
          .supported_reasoning_levels
        if (!Array.isArray(levels)) continue
        for (const level of levels) {
          const effort = (level as { effort?: unknown })?.effort
          if (typeof effort === 'string') declared.add(effort)
        }
      }
      if (declared.size > 0 && !declared.has(codex.reasoning_effort)) {
        return {
          ok: false,
          error: `reasoning_effort "${codex.reasoning_effort}" is not declared by any model in the catalog (declared: ${[...declared].sort().join(', ')})`,
        }
      }
    }
  }

  return { ok: true, profile: parsed.data }
}

/** Slugs a profile's codex catalog covers, for display and for the test route. */
export function catalogSlugs(profile: ModelProfile | null | undefined): string[] {
  return profile?.codex?.model_catalog?.models.map((m) => m.slug) ?? []
}
