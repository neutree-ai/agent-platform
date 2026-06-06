import i18n from '@/lib/i18n'
import { type ToolCall, safeParseResult } from '../types'
import type { ToolRendererDef } from '../types'

interface EditChange {
  type?: string
  unified_diff?: string
}

interface EditResult {
  stdout?: string
  success?: boolean
  changes?: Record<string, EditChange>
  status?: string
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono leading-relaxed max-h-60 overflow-y-auto">
      {diff.split('\n').map((line, i) => {
        let cls = ''
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-success'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-destructive'
        else if (line.startsWith('@@')) cls = 'text-info'
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        )
      })}
    </pre>
  )
}

function ChangeEntry({ path, change }: { path: string; change: EditChange }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-tiny text-foreground">{path}</span>
        {change.type && (
          <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-mini">
            {change.type}
          </span>
        )}
      </div>
      {change.unified_diff && <DiffBlock diff={change.unified_diff} />}
    </div>
  )
}

export const codexEditRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const changes = tool.input.changes as Record<string, unknown> | undefined
    if (!changes) return ''
    const paths = Object.keys(changes)
    return paths.length === 1
      ? paths[0]
      : i18n.t('components.chat.toolRenderers.codexEdit.preview.files', { count: paths.length })
  },

  renderInput(tool: ToolCall) {
    const changes = tool.input.changes as Record<string, EditChange> | undefined
    if (!changes) return null
    const entries = Object.entries(changes)
    return (
      <div className="space-y-2">
        {entries.map(([path, change]) => (
          <ChangeEntry key={path} path={path} change={change} />
        ))}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const parsed = safeParseResult<EditResult>(tool.result)
    if (!parsed || typeof parsed === 'string') return null

    if (!parsed.changes) {
      if (parsed.stdout) {
        return <div className="text-tiny text-muted-foreground">{parsed.stdout}</div>
      }
      return null
    }

    const entries = Object.entries(parsed.changes)
    return (
      <div className="space-y-2">
        {entries.map(([path, change]) => (
          <ChangeEntry key={path} path={path} change={change} />
        ))}
      </div>
    )
  },
}
