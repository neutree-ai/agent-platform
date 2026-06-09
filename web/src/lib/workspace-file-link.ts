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

// Skills are extracted to `/tmp/skill-<name>` (a tmpfs working copy) and
// symlinked into the workspace skills dir; see `internal/agent-skills`. Agents
// frequently report the extraction path (the symlink *target*), which lives
// outside every drive root and so dead-links to the site origin. Rewrite it to
// the workspace-drive symlink path, which dufs serves (it follows the symlink —
// that's how the skill editor reads these files).
const SKILL_TMP_PREFIX = '/tmp/skill-'

// Workspace-relative skills root the agent reports as `filesBrowsePath`. It's
// agent-specific (claude-code `/.claude/skills`, codex `/.home/.codex/skills`),
// so callers resolve the live value via `useSkillsBasePath` and pass it in; this
// default matches `DEFAULT_SKILLS_BASE_PATH` in the skill browser and is only
// used as a fallback before the value loads.
export const DEFAULT_SKILLS_BASE_PATH = '/.claude/skills'

/** True if `path` is an agent skill `/tmp` extraction path needing a rewrite. */
export function isSkillTmpPath(path: string | undefined | null): boolean {
  return !!path && path.startsWith(SKILL_TMP_PREFIX)
}

/**
 * Normalize a container-absolute path agents emit into one rooted at a drive
 * the file viewer can serve. Currently only rewrites skill `/tmp` extraction
 * paths; everything else passes through unchanged. Shared by the link parser
 * and the markdown image rewriter so both stay in lockstep.
 *
 * `skillsBasePath` is the workspace-relative skills root for the current
 * workspace's agent (see `useSkillsBasePath`); defaults to the claude-code
 * layout when not supplied.
 */
export function canonicalizeAgentPath(
  path: string,
  skillsBasePath: string = DEFAULT_SKILLS_BASE_PATH,
): string {
  if (path.startsWith(SKILL_TMP_PREFIX)) {
    // `/tmp/skill-<name>/<rest>` → `/workspace<base>/<name>/<rest>`, e.g.
    // `/workspace/.claude/skills/<name>/<rest>`. Also handles the bare skill
    // dir (`/tmp/skill-<name>`).
    const base = skillsBasePath.replace(/\/+$/, '')
    return `/workspace${base}/${path.slice(SKILL_TMP_PREFIX.length)}`
  }
  return path
}

/**
 * Parse an href emitted by an agent into the drive + workspace-relative path
 * we need to drive the Files panel / FileApp.
 *
 * `skillsBasePath` lets the caller resolve skill `/tmp` paths against the live
 * agent layout (claude-code vs codex); omit it to fall back to the default.
 *
 * Returns `null` if the href doesn't look like a workspace file reference, so
 * callers can fall through to default `<a>` behaviour.
 */
export function parseWorkspaceFileHref(
  href: string | undefined | null,
  skillsBasePath?: string,
): ParsedWorkspaceFileHref | null {
  if (!href) return null
  const canonical = canonicalizeAgentPath(href, skillsBasePath)
  let drive: DriveKind | null = null
  let rawPath: string | null = null
  for (const { prefix, drive: d } of DRIVE_PREFIXES) {
    if (canonical.startsWith(prefix)) {
      drive = d
      // Keep the leading `/` (strip only the prefix sans trailing slash).
      rawPath = canonical.slice(prefix.length - 1)
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
