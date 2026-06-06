/**
 * Pure: parse YAML frontmatter from SKILL.md content.
 * Extracts only `name` and `description`; everything else in the frontmatter
 * is ignored on purpose — skill discovery (per agent-skills spec) only relies
 * on these two fields, and we don't store the rest in DB.
 */
import { parse as parseYaml } from 'yaml'

interface SkillFrontmatter {
  name?: string
  description?: string
}

export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  let doc: unknown
  try {
    doc = parseYaml(match[1])
  } catch {
    return {}
  }
  if (!doc || typeof doc !== 'object') return {}
  const obj = doc as Record<string, unknown>
  const out: SkillFrontmatter = {}
  if (typeof obj.name === 'string') out.name = obj.name.trim()
  if (typeof obj.description === 'string') {
    out.description = obj.description.trim().replace(/\s+\n/g, '\n')
  }
  return out
}
