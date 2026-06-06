/**
 * Render the `__platform__` skill template tree into a files map suitable for
 * `SkillManager.installPlatformSkill()`.
 *
 * Template source lives at `<pkg>/platform/__platform__/` and is bundled with
 * agent-skills so OSS bumps refresh the content alongside the install lifecycle.
 *
 * Every `.md` under the template root is Mustache-rendered so reference files
 * can use the same conditionals (`{{#codex}}`, `{{#claudeCode}}`, `{{userName}}`)
 * as `SKILL.md`. Reference files that aren't relevant to the current agent
 * (e.g. `image-generation.md` on Claude Code) are harmless to ship — the entry
 * `SKILL.md` only mentions them under the matching conditional, so the CLI
 * never auto-loads them.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Mustache from 'mustache'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLATFORM_SKILL_DIR = join(__dirname, '..', 'platform', '__platform__')

export type AgentKind = 'claude-code' | 'codex'

export interface PlatformSkillView {
  workspaceId: string
  userName?: string
  agentKind: AgentKind
}

function walkMarkdown(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkMarkdown(full))
    } else if (entry.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

export function renderPlatformSkillFiles(view: PlatformSkillView): Record<string, string> {
  // Prompts are plain markdown — don't HTML-escape.
  Mustache.escape = (s: string) => s
  const mustacheView = {
    workspaceId: view.workspaceId,
    userName: view.userName || '',
    claudeCode: view.agentKind === 'claude-code',
    codex: view.agentKind === 'codex',
  }
  const files: Record<string, string> = {}
  for (const full of walkMarkdown(PLATFORM_SKILL_DIR)) {
    const rel = relative(PLATFORM_SKILL_DIR, full)
    const tpl = readFileSync(full, 'utf-8')
    files[rel] = Mustache.render(tpl, mustacheView)
  }
  return files
}
