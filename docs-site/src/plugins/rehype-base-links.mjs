import { visit } from 'unist-util-visit'

/**
 * Prefixes site-absolute links and asset paths in the content with the build's
 * base path, so pages can be written as `/self-host/single-node/` and stay
 * correct whichever base the distribution is served under.
 *
 * Astro rewrites the links it generates itself (sidebar, pagination, assets);
 * anything hand-written in .md/.mdx reaches the HTML untouched, which is what
 * this covers. MDX authors write plain `<a href="...">` too, so JSX elements
 * get the same treatment as markdown links.
 */
export function rehypeBaseLinks({ base }) {
  const prefix = base.replace(/\/+$/, '')
  if (!prefix) return () => {}

  const rewrite = (value) => {
    if (typeof value !== 'string') return value
    // Site-absolute only: leave protocol-relative, external, anchors and
    // relative paths alone.
    if (!value.startsWith('/') || value.startsWith('//')) return value
    if (value === prefix || value.startsWith(`${prefix}/`)) return value
    return prefix + value
  }

  const ATTRS = { a: 'href', area: 'href', img: 'src', source: 'src' }

  return (tree) => {
    visit(tree, (node) => {
      if (node.type === 'element') {
        const attr = ATTRS[node.tagName]
        if (attr && node.properties) node.properties[attr] = rewrite(node.properties[attr])
        return
      }
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        const attr = ATTRS[node.name]
        if (!attr) return
        for (const a of node.attributes ?? []) {
          if (a.type === 'mdxJsxAttribute' && a.name === attr) a.value = rewrite(a.value)
        }
      }
    })
  }
}
