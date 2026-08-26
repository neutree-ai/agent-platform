import { describe, expect, it } from 'vitest'
import { rehypeMermaid } from './rehype-mermaid'

interface Node {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
  value?: string
}

const transform = rehypeMermaid() as (tree: Node) => void

function codeFence(language: string, source: string): Node {
  return {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className: [`language-${language}`] },
        children: [{ type: 'text', value: source }],
      },
    ],
  }
}

function root(...children: Node[]): Node {
  return { type: 'root', children }
}

describe('rehypeMermaid', () => {
  it('replaces a mermaid fence with the custom element, keeping the source', () => {
    const tree = root(codeFence('mermaid', 'flowchart TD\n  A --> B'))
    transform(tree)
    expect(tree.children?.[0]).toEqual({
      type: 'element',
      tagName: 'mermaid-diagram',
      properties: {},
      children: [{ type: 'text', value: 'flowchart TD\n  A --> B' }],
    })
  })

  it('leaves other languages alone', () => {
    const tree = root(codeFence('ts', 'const a = 1'))
    transform(tree)
    expect((tree.children?.[0] as Node).tagName).toBe('pre')
  })

  it('accepts a string className', () => {
    const fence = codeFence('mermaid', 'graph TD')
    const code = fence.children?.[0] as Node
    code.properties = { className: 'language-mermaid hljs' }
    const tree = root(fence)
    transform(tree)
    expect((tree.children?.[0] as Node).tagName).toBe('mermaid-diagram')
  })

  it('rewrites fences nested inside other elements', () => {
    const tree = root({
      type: 'element',
      tagName: 'blockquote',
      properties: {},
      children: [codeFence('mermaid', 'graph TD')],
    })
    transform(tree)
    const quoted = (tree.children?.[0] as Node).children?.[0] as Node
    expect(quoted.tagName).toBe('mermaid-diagram')
  })
})
