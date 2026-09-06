import { describe, expect, it } from 'vitest'
import { rehypeRelativePaths, resolveRelativePath } from './rehype-relative-paths'

interface Node {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

function run(node: Node, baseDir = '/document/ctcli', drive: 'workspace' | 'afs' = 'workspace') {
  const transform = rehypeRelativePaths({ baseDir, drive }) as (tree: Node) => void
  const tree: Node = { type: 'root', children: [node] }
  transform(tree)
  return node.properties
}

function link(href: unknown): Node {
  return { type: 'element', tagName: 'a', properties: { href }, children: [] }
}

describe('resolveRelativePath', () => {
  it('resolves bare, dot and parent-relative paths', () => {
    expect(resolveRelativePath('/document/ctcli', 'USAGE.md')).toBe('/document/ctcli/USAGE.md')
    expect(resolveRelativePath('/document/ctcli', './docs/testing.md')).toBe(
      '/document/ctcli/docs/testing.md',
    )
    expect(resolveRelativePath('/document/ctcli', '../shared/x.md')).toBe('/document/shared/x.md')
    expect(resolveRelativePath('/', 'README.md')).toBe('/README.md')
  })

  it('keeps a trailing slash and rejects climbing above the root', () => {
    expect(resolveRelativePath('/document', 'docs/')).toBe('/document/docs/')
    expect(resolveRelativePath('/document', '../../etc')).toBeNull()
  })
})

describe('rehypeRelativePaths', () => {
  it('rewrites relative link and image targets onto the drive', () => {
    expect(run(link('USAGE.md')).href).toBe('/workspace/document/ctcli/USAGE.md')
    expect(run(link('./CHANGELOG.md')).href).toBe('/workspace/document/ctcli/CHANGELOG.md')
    expect(run(link('docs/release.md'), '/document/ctcli', 'afs').href).toBe(
      '/mnt/afs/document/ctcli/docs/release.md',
    )
    const img: Node = {
      type: 'element',
      tagName: 'img',
      properties: { src: 'images/arch.png' },
      children: [],
    }
    expect(run(img).src).toBe('/workspace/document/ctcli/images/arch.png')
  })

  it('drops the fragment so the target file still opens', () => {
    expect(run(link('USAGE.md#install')).href).toBe('/workspace/document/ctcli/USAGE.md')
  })

  it('leaves absolute, protocol and anchor hrefs alone', () => {
    expect(run(link('https://example.com/x')).href).toBe('https://example.com/x')
    expect(run(link('mailto:a@example.com')).href).toBe('mailto:a@example.com')
    expect(run(link('/workspace/other/y.md')).href).toBe('/workspace/other/y.md')
    expect(run(link('#section')).href).toBe('#section')
    expect(run(link(undefined)).href).toBeUndefined()
  })

  it('walks nested content such as table cells', () => {
    const cell: Node = {
      type: 'element',
      tagName: 'td',
      properties: {},
      children: [link('config.yaml.example')],
    }
    const transform = rehypeRelativePaths({ baseDir: '/document/ctcli', drive: 'workspace' }) as (
      tree: Node,
    ) => void
    transform({ type: 'root', children: [cell] })
    expect(cell.children?.[0].properties?.href).toBe(
      '/workspace/document/ctcli/config.yaml.example',
    )
  })
})
