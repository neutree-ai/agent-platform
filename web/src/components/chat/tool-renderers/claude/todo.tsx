import i18n from '@/lib/i18n'
import type { ToolCall } from '../types'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

const statusIcon: Record<string, string> = {
  completed: '✓',
  in_progress: '→',
  pending: '○',
}

const statusClass: Record<string, string> = {
  completed: 'text-success',
  in_progress: 'text-info',
  pending: 'text-muted-foreground',
}

export const todoRenderer = {
  getPreview(tool: ToolCall): string {
    const todos = tool.input.todos
    if (!Array.isArray(todos) || !todos.length) return ''
    const done = todos.filter((t) => t.status === 'completed').length
    const active = todos.find((t) => t.status === 'in_progress')
    const summary = i18n.t('components.chat.toolRenderers.claudeTodo.preview.done', {
      done,
      total: todos.length,
    })
    return active ? `${summary} · ${active.content}` : summary
  },
  renderInput(tool: ToolCall) {
    const todos = tool.input.todos as TodoItem[] | undefined
    if (!Array.isArray(todos) || !todos.length) return null

    return (
      <div className="space-y-0.5">
        {todos.map((t, i) => (
          <div key={i} className="flex items-start gap-1.5 text-tiny">
            <span className={`${statusClass[t.status] || 'text-muted-foreground'} flex-shrink-0`}>
              {statusIcon[t.status] || '○'}
            </span>
            <span className={t.status === 'completed' ? 'line-through text-muted-foreground' : ''}>
              {t.content}
            </span>
          </div>
        ))}
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}
