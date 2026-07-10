import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Mustache from 'mustache'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = join(__dirname, '..', 'prompt.md')

export type AgentKind = 'claude-code' | 'codex' | 'goose'

export interface MemoryAttachmentView {
  storeId: string
  storeName: string
  storeDescription: string
  access: 'read_only' | 'read_write'
  instructions: string
  /** Snapshot of `MEMORY.md` content at config-render time, if the store has one. */
  indexContent?: string | null
}

export interface WritePlatformPromptOptions {
  agentKind: AgentKind
  homeSubdir: string
  filename: string
  workspaceId: string | undefined
  userName?: string | undefined
  memoryAttachments?: MemoryAttachmentView[]
}

export function renderPlatformPrompt(
  opts: Pick<
    WritePlatformPromptOptions,
    'agentKind' | 'workspaceId' | 'userName' | 'memoryAttachments'
  >,
): string {
  const template = readFileSync(TEMPLATE_PATH, 'utf-8')
  const attachments = opts.memoryAttachments ?? []
  const view = {
    workspaceId: opts.workspaceId ?? 'unknown',
    userName: opts.userName || '',
    claudeCode: opts.agentKind === 'claude-code',
    codex: opts.agentKind === 'codex',
    goose: opts.agentKind === 'goose',
    hasMemoryAttachments: attachments.length > 0,
    memoryAttachments: attachments.map((a) => {
      const idx = (a.indexContent ?? '').trim()
      return {
        storeId: a.storeId,
        storeName: a.storeName,
        storeDescription: a.storeDescription,
        access: a.access,
        instructions: a.instructions,
        hasInstructions: a.instructions.trim().length > 0,
        hasIndex: idx.length > 0,
        // Mustache triple-stache is mapped to the un-escaped pass-through above,
        // but we still strip trailing whitespace so the fenced block stays tidy.
        indexContent: idx,
      }
    }),
  }
  // Disable HTML escaping — prompts are plain text/markdown, not HTML.
  Mustache.escape = (text: string) => text
  return Mustache.render(template, view)
}

export function writePlatformPrompt(opts: WritePlatformPromptOptions): void {
  const home = process.env.HOME || '/root'
  const dir = join(home, opts.homeSubdir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, opts.filename), renderPlatformPrompt(opts))
}
