import { transcriptI18n as i18n } from '../../i18n'
import { DiffView } from '../../ui/diff-view'
import { type ToolCall, type ToolRendererDef, safeParseResult, truncate } from '../types'

/**
 * Renderers for goose's builtin tools (developer extension and friends).
 *
 * Input shapes come from goose's own tool schemas (dumped via the
 * `_goose/unstable/tools/list` ACP method):
 *  - shell:      { command: string, timeout_secs?: number }
 *  - edit:       { path, before, after }  (whole-text replacement, not a diff)
 *  - write:      { path, content }
 *  - tree:       { path, depth? }
 *  - read_image: { source, crop? }
 *  - todo__todo_write: { content }  (markdown checklist)
 *  - delegate:   { instructions?, model?, provider?, max_turns?, ... }
 *  - load_skill: { name, args? }
 *
 * Shell results arrive as JSON `{ stdout, stderr, exit_code }`; most other
 * tools return plain text.
 */

interface GooseShellResult {
  stdout?: string
  stderr?: string
  exit_code?: number
}

function textResult(tool: ToolCall): string | null {
  const parsed = safeParseResult<unknown>(tool.result)
  return typeof parsed === 'string' && parsed.length > 0 ? parsed : null
}

function monoBlock(text: string) {
  return (
    <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono max-h-60 overflow-y-auto">
      {text}
    </pre>
  )
}

export const gooseShellRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return truncate(String(tool.input.command || ''))
  },

  renderInput(tool: ToolCall) {
    const cmd = String(tool.input.command || '')
    if (!cmd) return null
    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {i18n.t('components.chat.toolRenderers.claudeBash.labels.command')}
        </div>
        {monoBlock(cmd)}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const parsed = safeParseResult<GooseShellResult>(tool.result)
    if (!parsed || typeof parsed !== 'object') return null
    const { stdout, stderr, exit_code } = parsed
    if (stdout == null && stderr == null && exit_code == null) return null
    return (
      <div className="space-y-1">
        {stdout ? (
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              {i18n.t('components.chat.toolRenderers.codexExec.labels.stdout')}
            </div>
            {monoBlock(stdout)}
          </div>
        ) : null}
        {stderr ? (
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              {i18n.t('components.chat.toolRenderers.codexExec.labels.stderr')}
            </div>
            {monoBlock(stderr)}
          </div>
        ) : null}
        {exit_code != null && exit_code !== 0 && (
          <div className="text-mini text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.codexExec.labels.exitCode', {
              value: exit_code,
            })}
          </div>
        )}
      </div>
    )
  },
}

export const gooseEditRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.path || '')
  },

  renderInput(tool: ToolCall) {
    const path = String(tool.input.path || '')
    const before = tool.input.before as string | undefined
    const after = tool.input.after as string | undefined
    if (before == null && after == null) return null
    return (
      <div className="space-y-1">
        <div className="font-mono text-tiny text-foreground">{path}</div>
        <div className="rounded overflow-hidden border border-foreground/[0.08] max-h-60 overflow-y-auto">
          <DiffView
            oldText={before ?? ''}
            newText={after ?? ''}
            oldLabel={i18n.t('components.chat.toolRenderers.claudeFileEdit.labels.old')}
            newLabel={i18n.t('components.chat.toolRenderers.claudeFileEdit.labels.new')}
          />
        </div>
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}

export const gooseWriteRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.path || '')
  },

  renderInput(tool: ToolCall) {
    const path = String(tool.input.path || '')
    const content = tool.input.content as string | undefined
    if (content === undefined) return null
    return (
      <div className="space-y-1">
        <div className="font-mono text-tiny text-foreground">{path}</div>
        {monoBlock(content)}
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}

export const gooseTreeRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.path || '')
  },

  renderInput(tool: ToolCall) {
    const path = String(tool.input.path || '')
    if (!path) return null
    return <div className="font-mono text-tiny text-foreground">{path}</div>
  },

  renderResult(tool: ToolCall) {
    const text = textResult(tool)
    return text ? monoBlock(text) : null
  },
}

export const gooseReadImageRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.source || '')
  },

  renderInput(tool: ToolCall) {
    const source = String(tool.input.source || '')
    if (!source) return null
    return <div className="font-mono text-tiny text-foreground">{source}</div>
  },

  renderResult(): null {
    return null
  },
}

export const gooseTodoWriteRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const content = String(tool.input.content || '')
    return truncate(content.split('\n')[0] ?? '')
  },

  renderInput(tool: ToolCall) {
    const content = tool.input.content as string | undefined
    return content ? monoBlock(content) : null
  },

  renderResult(): null {
    return null
  },
}

export const gooseDelegateRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return truncate(String(tool.input.instructions || ''))
  },

  renderInput(tool: ToolCall) {
    const instructions = tool.input.instructions as string | undefined
    const model = tool.input.model as string | undefined
    const provider = tool.input.provider as string | undefined
    if (!instructions && !model) return null
    return (
      <div className="space-y-1">
        {instructions ? monoBlock(instructions) : null}
        {(model || provider) && (
          <div className="text-mini text-muted-foreground font-mono">
            {[provider, model].filter(Boolean).join(' / ')}
          </div>
        )}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const text = textResult(tool)
    return text ? monoBlock(text) : null
  },
}

export const gooseLoadSkillRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    return String(tool.input.name || '')
  },

  renderInput(tool: ToolCall) {
    const name = String(tool.input.name || '')
    const args = tool.input.args as string | undefined
    if (!name) return null
    return (
      <div className="font-mono text-tiny text-foreground">
        {name}
        {args ? ` ${args}` : ''}
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}
