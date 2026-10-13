import { describe, expect, it } from 'vitest'
import {
  getSlashQuery,
  insertWithPadding,
  matchTrigger,
  parseTemplateVariables,
  replaceRange,
  resolveTemplate,
} from './text'

describe('parseTemplateVariables', () => {
  it('lists unique variables in first-appearance order', () => {
    expect(parseTemplateVariables('{{b}} and {{a}} then {{b}}')).toEqual(['b', 'a'])
  })

  it('ignores malformed placeholders', () => {
    expect(parseTemplateVariables('{{ spaced }} {single} {{ok}}')).toEqual(['ok'])
  })

  it('returns an empty list for plain text', () => {
    expect(parseTemplateVariables('/compact')).toEqual([])
  })
})

describe('resolveTemplate', () => {
  it('substitutes every occurrence', () => {
    expect(resolveTemplate('/goal {{c}} ({{c}})', { c: 'done' })).toBe('/goal done (done)')
  })

  it('resolves unknown variables to an empty string', () => {
    expect(resolveTemplate('a{{x}}b', {})).toBe('ab')
  })

  it('does not re-expand placeholders inside values', () => {
    expect(resolveTemplate('{{a}}', { a: '{{b}}', b: 'no' })).toBe('{{b}}')
  })
})

describe('getSlashQuery', () => {
  it('returns the lowercased query for a single slash line', () => {
    expect(getSlashQuery('/Rel')).toBe('rel')
    expect(getSlashQuery('/')).toBe('')
  })

  it('is null for text that does not start with a slash', () => {
    expect(getSlashQuery('hello /rel')).toBeNull()
  })

  it('is null once the input spans several lines', () => {
    expect(getSlashQuery('/rel\nmore')).toBeNull()
  })
})

describe('matchTrigger', () => {
  const at = /@([a-z]*)$/

  it('matches a fragment that ends at the caret', () => {
    expect(matchTrigger(at, 'hi @bo', 6)).toEqual({ start: 3, end: 6, query: 'bo' })
  })

  it('only looks at text before the caret', () => {
    expect(matchTrigger(at, 'hi @bob tail', 7)).toEqual({ start: 3, end: 7, query: 'bob' })
    expect(matchTrigger(at, 'hi @bob tail', 12)).toBeNull()
  })

  it('tolerates a global pattern', () => {
    expect(matchTrigger(/@([a-z]*)$/g, '@x', 2)).toEqual({ start: 0, end: 2, query: 'x' })
  })

  it('reports an empty query for patterns without a capture group', () => {
    expect(matchTrigger(/#$/, 'a #', 3)).toEqual({ start: 2, end: 3, query: '' })
  })
})

describe('replaceRange', () => {
  it('splices text in and places the caret after it', () => {
    expect(replaceRange('say @ag now', 4, 7, '@agent/x ')).toEqual({
      value: 'say @agent/x  now',
      caret: 13,
    })
  })
})

describe('insertWithPadding', () => {
  it('inserts into an empty input with a trailing space', () => {
    expect(insertWithPadding('', 0, 0, '@file/a.md')).toEqual({ value: '@file/a.md ', caret: 11 })
  })

  it('adds a leading space after a word', () => {
    expect(insertWithPadding('see', 3, 3, '@file/a')).toEqual({ value: 'see @file/a ', caret: 12 })
  })

  it('reuses whitespace that already follows the caret', () => {
    expect(insertWithPadding('a  b', 1, 1, 'X')).toEqual({ value: 'a X  b', caret: 4 })
  })

  it('replaces the selection', () => {
    expect(insertWithPadding('one two three', 4, 7, 'X')).toEqual({
      value: 'one X three',
      caret: 6,
    })
  })
})
