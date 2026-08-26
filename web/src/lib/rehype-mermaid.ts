import type { Plugin } from 'unified'

interface HastNode {
  type: string
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
  value?: string
}

function classNames(node: HastNode): string[] {
  const raw = node.properties?.className
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(/\s+/)
  return []
}

function isMermaidCode(node: HastNode): boolean {
  return (
    node.type === 'element' &&
    node.tagName === 'code' &&
    classNames(node).includes('language-mermaid')
  )
}

/**
 * Rewrites ```mermaid fences into `<mermaid-diagram>` so our own renderer
 * handles them (see `components/ui/mermaid-diagram.tsx`) instead of
 * Streamdown's built-in mermaid block.
 *
 * Runs after `rehype-sanitize` in the plugin list, so the custom tag it
 * introduces does not need to be whitelisted in the sanitize schema.
 */
export const rehypeMermaid: Plugin = () => (tree: unknown) => {
  const walk = (node: HastNode) => {
    const children = node.children
    if (!children) return
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      const code =
        child.type === 'element' && child.tagName === 'pre'
          ? child.children?.find(isMermaidCode)
          : isMermaidCode(child)
            ? child
            : undefined
      if (code) {
        children[i] = {
          type: 'element',
          tagName: 'mermaid-diagram',
          properties: {},
          children: code.children ?? [],
        }
        continue
      }
      walk(child)
    }
  }
  walk(tree as HastNode)
}
