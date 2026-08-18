import { describe, expect, it } from 'vitest'
import { catalogSlugs, checkModelProfile } from './model-profile'

const catalogModel = (slug: string, efforts: string[] = ['low', 'high']) => ({
  slug,
  display_name: slug,
  supported_reasoning_levels: efforts.map((effort) => ({ effort, description: effort })),
})

const profile = (over: Record<string, unknown> = {}) => ({
  codex: {
    model_catalog: { models: [catalogModel('deepseek-v4-flash'), catalogModel('deepseek-v4-pro')] },
    ...over,
  },
})

describe('checkModelProfile', () => {
  it('treats undefined and null alike as no profile', () => {
    expect(checkModelProfile(undefined)).toEqual({ ok: true, profile: null })
    expect(checkModelProfile(null)).toEqual({ ok: true, profile: null })
  })

  it('accepts a catalog and keeps fields it does not know about', () => {
    const result = checkModelProfile(profile({ validated_with: '0.144.6' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Codex reads far more per-model fields than cp validates; dropping the
    // unknown ones here would ship a catalog that no longer describes the model.
    const model = result.profile?.codex?.model_catalog?.models[0] as Record<string, unknown>
    expect(model.display_name).toBe('deepseek-v4-flash')
    expect(result.profile?.codex?.validated_with).toBe('0.144.6')
  })

  it('keeps a core it has never heard of', () => {
    const result = checkModelProfile({ ...profile(), someFutureCore: { anything: true } })
    expect(result.ok).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(checkModelProfile('{}')).toEqual({
      ok: false,
      error: 'model_profile must be an object',
    })
    expect(checkModelProfile([])).toEqual({
      ok: false,
      error: 'model_profile must be an object',
    })
  })

  it('rejects a catalog with no models', () => {
    const result = checkModelProfile({ codex: { model_catalog: { models: [] } } })
    expect(result.ok).toBe(false)
  })

  it('rejects a model without a slug — codex matches by slug', () => {
    const result = checkModelProfile({
      codex: { model_catalog: { models: [{ display_name: 'no slug' }] } },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate slugs', () => {
    const result = checkModelProfile({
      codex: {
        model_catalog: {
          models: [catalogModel('deepseek-v4-pro'), catalogModel('deepseek-v4-pro')],
        },
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('more than once')
  })

  it('rejects a reasoning effort no model in the catalog declares', () => {
    const result = checkModelProfile(profile({ reasoning_effort: 'medium' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('medium')
    expect(result.error).toContain('high, low')
  })

  it('accepts an effort declared by any model, since the workspace picks later', () => {
    const result = checkModelProfile({
      codex: {
        model_catalog: {
          models: [catalogModel('flash', ['low']), catalogModel('pro', ['low', 'max'])],
        },
        reasoning_effort: 'max',
      },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an effort with no catalog to check it against', () => {
    const result = checkModelProfile({ codex: { reasoning_effort: 'high' } })
    expect(result.ok).toBe(true)
  })

  it('rejects an effort codex has no notion of', () => {
    const result = checkModelProfile({ codex: { reasoning_effort: 'ludicrous' } })
    expect(result.ok).toBe(false)
  })

  it('rejects a profile past the size ceiling', () => {
    const bulk = 'x'.repeat(1024 * 1024)
    const result = checkModelProfile({ codex: { model_catalog: { models: [catalogModel(bulk)] } } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('over the')
  })
})

describe('catalogSlugs', () => {
  it('lists what a catalog covers', () => {
    const result = checkModelProfile(profile())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(catalogSlugs(result.profile)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('is empty without a profile', () => {
    expect(catalogSlugs(null)).toEqual([])
    expect(catalogSlugs({ codex: {} })).toEqual([])
  })
})
