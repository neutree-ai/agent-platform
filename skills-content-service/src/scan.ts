/**
 * Pure: scan tar entries for all skill candidates (root or nested).
 *
 * Used by the `POST /skills/scan-preview` endpoint (multi-skill import
 * pre-flight) and shared with the from-git happy path so a single tarball
 * fetch can land both behaviours.
 */
import { parseFrontmatter } from './parse-frontmatter'
import type { TarEntry } from './skill-tar'

interface CandidateFile {
  /** Path relative to the skill root (subpath prefix stripped). */
  path: string
  /** Byte size of the file body. */
  size: number
}

interface SkillCandidate {
  /** Empty string when the SKILL.md is at the root, otherwise the directory path. */
  subpath: string
  name: string | null
  description: string | null
  fileCount: number
  /**
   * Files belonging to this skill (paths relative to the skill root,
   * sorted alphabetically). Carried in the scan response so the preview
   * dialog can show what would land without a second tarball fetch.
   */
  files: CandidateFile[]
  /** Raw SKILL.md body (frontmatter + markdown). Null if unreadable. */
  skillMd: string | null
}

export function scanSkills(entries: TarEntry[]): SkillCandidate[] {
  // Find each (sub)dir that holds a SKILL.md, parse its frontmatter, count
  // sibling files under the same dir.
  const skillMdByDir = new Map<string, TarEntry>()
  for (const entry of entries) {
    if (entry.header.type !== 'file') continue
    const name = entry.header.name
    const lower = name.toLowerCase()
    if (lower === 'skill.md') {
      skillMdByDir.set('', entry)
    } else if (lower.endsWith('/skill.md')) {
      const dir = name.slice(0, name.lastIndexOf('/'))
      if (dir) skillMdByDir.set(dir, entry)
    }
  }

  const out: SkillCandidate[] = []
  for (const [dir, mdEntry] of skillMdByDir) {
    const mdBody = mdEntry.data.toString('utf-8')
    const fm = parseFrontmatter(mdBody)
    const prefix = dir ? `${dir}/` : ''
    const files: CandidateFile[] = []
    for (const entry of entries) {
      if (entry.header.type !== 'file') continue
      const name = entry.header.name
      if (dir === '') {
        // Root skill: file is at root and not inside another skill subdir.
        if (name.includes('/')) {
          const topDir = name.slice(0, name.indexOf('/'))
          if (skillMdByDir.has(topDir)) continue
        }
        files.push({ path: name, size: entry.data.length })
      } else if (name.startsWith(prefix) && name.slice(prefix.length).length > 0) {
        files.push({ path: name.slice(prefix.length), size: entry.data.length })
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    out.push({
      subpath: dir,
      name: fm.name ?? null,
      description: fm.description ?? null,
      fileCount: files.length,
      files,
      skillMd: mdBody,
    })
  }
  // Sort for deterministic ordering: root first, then alphabetical by subpath.
  out.sort((a, b) => {
    if (a.subpath === '') return -1
    if (b.subpath === '') return 1
    return a.subpath.localeCompare(b.subpath)
  })
  return out
}
