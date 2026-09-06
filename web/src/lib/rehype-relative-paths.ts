import type { DriveKind } from '@/lib/api/agent-files'
import type { Plugin } from 'unified'

interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

interface RelativePathOptions {
  /** Drive-relative directory holding the document, e.g. `/document/ctcli`. */
  baseDir: string
  drive: DriveKind
}

const DRIVE_ROOTS: Record<DriveKind, string> = {
  workspace: '/workspace',
  afs: '/mnt/afs',
}

/** Anything with a scheme, a protocol-relative host, a fragment, or already rooted. */
function isAbsoluteRef(url: string): boolean {
  return (
    url.startsWith('/') ||
    url.startsWith('#') ||
    url.startsWith('?') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
  )
}

/**
 * Resolve `rel` against `baseDir`, both drive-relative. Returns `null` when the
 * path climbs above the drive root, which the file viewer cannot serve anyway.
 */
export function resolveRelativePath(baseDir: string, rel: string): string | null {
  const segments = baseDir.split('/').filter(Boolean)
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(part)
  }
  const path = `/${segments.join('/')}`
  return rel.endsWith('/') && !path.endsWith('/') ? `${path}/` : path
}

function rewrite(url: unknown, { baseDir, drive }: RelativePathOptions): string | null {
  if (typeof url !== 'string' || url === '' || isAbsoluteRef(url)) return null
  // Markdown anchors (`USAGE.md#install`) point inside the linked document; the
  // file viewer opens whole files, so the target file is the useful part.
  const path = resolveRelativePath(baseDir, url.split('#')[0].split('?')[0])
  return path === null ? null : `${DRIVE_ROOTS[drive]}${path}`
}

/**
 * Rewrites document-relative link/image targets into the container-absolute
 * paths the rest of the stack understands (`/workspace/...`, `/mnt/afs/...`),
 * so a README's `[USAGE.md](USAGE.md)` resolves next to the README instead of
 * against the site origin.
 *
 * Must run *before* `rehype-harden`: harden drops bare relative hrefs outright
 * (rendering them as `text [blocked]`) and rebases `./x` ones onto the site
 * root.
 */
export const rehypeRelativePaths: Plugin<[RelativePathOptions]> =
  (options: RelativePathOptions) => (tree: unknown) => {
    const walk = (node: HastNode) => {
      if (node.type === 'element' && node.properties) {
        const attr = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null
        if (attr) {
          const next = rewrite(node.properties[attr], options)
          if (next !== null) node.properties[attr] = next
        }
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree as HastNode)
  }
