import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './parse-frontmatter'

describe('parseFrontmatter', () => {
  it('returns empty when no frontmatter fence', () => {
    expect(parseFrontmatter('# just a title\n\nbody')).toEqual({})
  })

  it('extracts name and description', () => {
    const text = '---\nname: my-skill\ndescription: does a thing\n---\n\nbody'
    expect(parseFrontmatter(text)).toEqual({ name: 'my-skill', description: 'does a thing' })
  })

  it('extracts only name when description absent', () => {
    expect(parseFrontmatter('---\nname: solo\n---\nbody')).toEqual({ name: 'solo' })
  })

  it('trims name', () => {
    expect(parseFrontmatter('---\nname:   spaced  \n---\n')).toEqual({ name: 'spaced' })
  })

  it('normalizes description whitespace before newlines', () => {
    const text = '---\ndescription: |\n  line one   \n  line two\n---\n'
    const out = parseFrontmatter(text)
    expect(out.description).toBe('line one\nline two')
  })

  it('returns empty on malformed YAML', () => {
    expect(parseFrontmatter('---\nname: [unclosed\n---\n')).toEqual({})
  })

  it('returns empty when YAML is not an object', () => {
    expect(parseFrontmatter('---\n42\n---\n')).toEqual({})
  })

  it('ignores non-string name/description', () => {
    expect(parseFrontmatter('---\nname: 1\ndescription: true\n---\n')).toEqual({})
  })

  it('accepts CRLF line endings', () => {
    expect(parseFrontmatter('---\r\nname: crlf\r\n---\r\nbody')).toEqual({ name: 'crlf' })
  })
})
