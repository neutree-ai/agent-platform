/**
 * Slug rules for the Agent Skills discovery protocol.
 *
 * The `npx skills` client validates every index entry and *silently drops*
 * the ones that fail — a malformed name produces an empty skill list, not an
 * error. These tests pin the exact rules so a regression surfaces here rather
 * than as "the install did nothing".
 *
 * The module under test lives in `internal/types` because web derives the
 * same slug client-side (to pre-fill the export dialog) and the two must not
 * drift. The test lives here because cp is the only consumer with a runner,
 * and cp is where the rules are actually enforced.
 */
import { describe, expect, it } from 'vitest'
import { deriveSkillSlug, isValidSkillSlug } from '../../../internal/types/skill-slug'

describe('isValidSkillSlug', () => {
  it.each(['code-review', 'a', '123', 'a-b-c', 'x'.repeat(64)])('accepts %j', (slug) => {
    expect(isValidSkillSlug(slug)).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['-lead', 'leading hyphen'],
    ['trail-', 'trailing hyphen'],
    ['a--b', 'consecutive hyphens'],
    ['Caps', 'uppercase'],
    ['under_score', 'underscore'],
    ['with space', 'space'],
    ['术语', 'non-latin'],
    ['x'.repeat(65), 'over 64 chars'],
  ])('rejects %j (%s)', (slug) => {
    expect(isValidSkillSlug(slug)).toBe(false)
  })
})

describe('deriveSkillSlug', () => {
  it('passes through an already-valid name', () => {
    expect(deriveSkillSlug('code-review')).toBe('code-review')
  })

  it('lowercases and replaces spaces', () => {
    expect(deriveSkillSlug('Code Review')).toBe('code-review')
  })

  it('collapses runs of separators into a single hyphen', () => {
    // Consecutive hyphens are rejected by the client, so `a  b` must not
    // become `a--b`.
    expect(deriveSkillSlug('PR   Review__Helper')).toBe('pr-review-helper')
  })

  it('strips leading and trailing separators', () => {
    expect(deriveSkillSlug('  _release notes_  ')).toBe('release-notes')
  })

  it('truncates to 64 chars without leaving a trailing hyphen', () => {
    // 'abc ' → 'abc-' (4 chars), so the 64-char cut lands exactly on a
    // separator — the case where truncation itself creates a trailing hyphen.
    const slug = deriveSkillSlug('abc '.repeat(20))
    expect(slug).toBe(`${'abc-'.repeat(15)}abc`)
    expect(slug?.length).toBe(63)
  })

  it.each([
    ['术语检查', 'all CJK'],
    ['!!!', 'punctuation only'],
    ['---', 'hyphens only'],
    ['🎉', 'emoji only'],
    ['   ', 'whitespace only'],
  ])('returns null for %j (%s) so the caller can ask for one', (name) => {
    expect(deriveSkillSlug(name)).toBeNull()
  })

  it('keeps whatever latin survives a mixed name', () => {
    expect(deriveSkillSlug('术语 check 检查')).toBe('check')
  })

  it('only ever returns slugs the client accepts', () => {
    const names = [
      'code-review',
      'Code Review',
      'PR   Review__Helper',
      '  _release notes_  ',
      'abc '.repeat(20),
      'Skill (v2) — final',
      'emoji 🎉 skill',
      '123',
      '术语 check 检查',
    ]
    for (const name of names) {
      const slug = deriveSkillSlug(name)
      expect(slug, `expected a slug for ${name}`).not.toBeNull()
      expect(isValidSkillSlug(slug as string), `bad slug ${slug} from ${name}`).toBe(true)
    }
  })
})
