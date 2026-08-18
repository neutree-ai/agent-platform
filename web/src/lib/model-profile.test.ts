import { describe, expect, it } from 'vitest'
import { buildModelProfile, catalogToText, parseCatalogText } from './model-profile'

const catalog = { models: [{ slug: 'deepseek-v4-flash' }, { slug: 'deepseek-v4-pro' }] }

describe('parseCatalogText', () => {
  it('accepts empty text as "no catalog"', () => {
    expect(parseCatalogText('   ')).toEqual({ ok: true, slugs: [] })
  })

  it('lists the slugs a catalog covers', () => {
    expect(parseCatalogText(JSON.stringify(catalog))).toEqual({
      ok: true,
      slugs: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    })
  })

  it('rejects malformed JSON, a missing models array, and a model without a slug', () => {
    expect(parseCatalogText('{').ok).toBe(false)
    expect(parseCatalogText('{"models":[]}').ok).toBe(false)
    expect(parseCatalogText('{"models":[{"display_name":"x"}]}').ok).toBe(false)
  })

  it('rejects duplicate slugs, which codex would resolve arbitrarily', () => {
    expect(parseCatalogText('{"models":[{"slug":"a"},{"slug":"a"}]}').ok).toBe(false)
  })
})

describe('buildModelProfile', () => {
  it('keeps profile keys the form does not edit', () => {
    const stored = {
      codex: { wire_api: 'responses', validated_with: '0.144.6' },
      futureCore: { anything: true },
    } as never
    const next = buildModelProfile(stored, JSON.stringify(catalog), 'high') as Record<string, never>
    const codex = next.codex as Record<string, unknown>
    expect(codex.wire_api).toBe('responses')
    expect(codex.validated_with).toBe('0.144.6')
    expect(next.futureCore).toEqual({ anything: true })
    expect(codex.reasoning_effort).toBe('high')
  })

  it('drops the catalog and the effort when both are cleared', () => {
    const stored = { codex: { model_catalog: catalog, reasoning_effort: 'high' } } as never
    expect(buildModelProfile(stored, '', '')).toBeNull()
  })

  it('leaves other cores in place when codex is emptied', () => {
    const stored = { codex: { model_catalog: catalog }, futureCore: { on: true } } as never
    expect(buildModelProfile(stored, '', '')).toEqual({ futureCore: { on: true } })
  })

  it('round-trips through the editor unchanged', () => {
    const built = buildModelProfile(null, JSON.stringify(catalog), '')
    expect(JSON.parse(catalogToText(built))).toEqual(catalog)
  })
})
