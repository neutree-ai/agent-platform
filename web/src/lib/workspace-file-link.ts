import type { DriveKind } from '@/lib/api/agent-files'

interface ParsedWorkspaceFileHref {
  drive: DriveKind
  /** Path relative to the drive root, with leading slash. May or may not end in `/`. */
  filePath: string
  viewingLine?: number
  viewingColumn?: number
}

// Map container-absolute prefixes agents emit to the drive kind that owns
// them. Keep in lockstep with the image rewriter in `components/ui/markdown.tsx`
// (`WorkspaceFileImg`).
const DRIVE_PREFIXES: Array<{ prefix: string; drive: DriveKind }> = [
  { prefix: '/workspace/', drive: 'workspace' },
  { prefix: '/mnt/afs/', drive: 'afs' },
]

/**
 * Parse an href emitted by an agent into the drive + workspace-relative path
 * we need to drive the Files panel / FileApp.
 *
 * Returns `null` if the href doesn't look like a workspace file reference, so
 * callers can fall through to default `<a>` behaviour.
 */
export function parseWorkspaceFileHref(
  href: string | undefined | null,
): ParsedWorkspaceFileHref | null {
  if (!href) return null
  let drive: DriveKind | null = null
  let rawPath: string | null = null
  for (const { prefix, drive: d } of DRIVE_PREFIXES) {
    if (href.startsWith(prefix)) {
      drive = d
      // Keep the leading `/` (strip only the prefix sans trailing slash).
      rawPath = href.slice(prefix.length - 1)
      break
    }
  }
  if (!drive || rawPath === null) return null

  // The href comes from markdown so any non-ASCII in the path is
  // percent-encoded. Decode once here so we don't re-encode the `%` signs
  // (which would turn CJK filenames into `%25E9...` garbage).
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    decoded = rawPath
  }

  // Strip IDE-style `:line[:col]` anchors agents emit (e.g.
  // `/workspace/foo/bar.ts:42:5`). Gate on `.ext` before the colon so
  // filenames containing `:` (e.g. `report:01.md`) survive.
  let viewingLine: number | undefined
  let viewingColumn: number | undefined
  let filePath = decoded
  const m = decoded.match(/^(.+\.[A-Za-z0-9_]+):(\d+)(?::(\d+))?$/)
  if (m) {
    filePath = m[1]
    viewingLine = Number(m[2])
    viewingColumn = m[3] ? Number(m[3]) : undefined
  }

  return { drive, filePath, viewingLine, viewingColumn }
}
