import { describe, expect, it } from 'vitest'
import { getFileMention } from './FileMention'

describe('getFileMention', () => {
  it('matches a bare trigger', () => {
    expect(getFileMention('@file/', 6)).toEqual({ path: '', start: 0, end: 6 })
  })

  it('matches a simple path', () => {
    expect(getFileMention('@file/foo', 9)).toEqual({ path: 'foo', start: 0, end: 9 })
  })

  it('reports start/end relative to surrounding text', () => {
    // "hello @file/foo" — trigger starts at index 6.
    expect(getFileMention('hello @file/foo', 15)).toEqual({ path: 'foo', start: 6, end: 15 })
  })

  it('keeps spaces inside the path (the spaces-in-folder-name bug)', () => {
    // Drilled into a folder whose name contains spaces.
    expect(getFileMention('@file/报警 UI 优化/', 15)).toEqual({
      path: '报警 UI 优化/',
      start: 0,
      end: 15,
    })
    // Still typing a query under that folder.
    expect(getFileMention('@file/报警 UI 优化/dra', 18)).toEqual({
      path: '报警 UI 优化/dra',
      start: 0,
      end: 18,
    })
  })

  it('returns null when there is no trigger before the cursor', () => {
    expect(getFileMention('just some text', 14)).toBeNull()
    expect(getFileMention('@file', 5)).toBeNull()
  })

  it('only considers text up to the cursor', () => {
    const input = '@file/foo bar'
    // Cursor right after "foo" — "bar" is past the cursor and ignored.
    expect(getFileMention(input, 9)).toEqual({ path: 'foo', start: 0, end: 9 })
  })

  it('binds to the last trigger when several are present', () => {
    const input = '@file/a.md @file/b'
    expect(getFileMention(input, input.length)).toEqual({ path: 'b', start: 11, end: 18 })
  })

  it('does not let one mention swallow an earlier one', () => {
    // Cursor inside the first mention — it must not reach across the second '@'.
    const input = '@file/a.md @file/b'
    expect(getFileMention(input, 10)).toEqual({ path: 'a.md', start: 0, end: 10 })
  })

  it('does not span newlines', () => {
    expect(getFileMention('@file/foo\nbar', 13)).toBeNull()
  })

  it('does not span an @ (no @ allowed in the path)', () => {
    expect(getFileMention('@file/a@b', 9)).toBeNull()
  })
})
