import { transcriptI18n as i18n } from '../../i18n'
import { getMcpText, safeParseResult } from '../types'
import type { ToolCall } from '../types'

// SDK 0.3.142 replaced the single-call TodoWrite (whole-list snapshot) with
// per-task tools: TaskCreate / TaskUpdate operate on one task, TaskList /
// TaskGet are reads. Legacy TodoWrite calls still live in persisted
// transcripts, so the old todoRenderer stays registered alongside these.

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

interface TaskItem {
  id?: string
  subject?: string
  content?: string
  status?: TaskStatus
}

const statusIcon: Record<string, string> = {
  completed: '✓',
  in_progress: '→',
  pending: '○',
  deleted: '✕',
}

const statusClass: Record<string, string> = {
  completed: 'text-success',
  in_progress: 'text-info',
  pending: 'text-muted-foreground',
  deleted: 'text-muted-foreground line-through',
}

function statusLabel(status?: string): string {
  if (!status) return ''
  return i18n.t(`components.chat.toolRenderers.claudeTask.status.${status}`, {
    defaultValue: status,
  })
}

function title(item: TaskItem): string {
  return item.subject || item.content || (item.id ? `#${item.id}` : '')
}

/** One task line: status icon + title. */
function TaskLine({ item }: { item: TaskItem }) {
  const status = item.status || 'pending'
  return (
    <div className="flex items-start gap-1.5 text-tiny">
      <span className={`${statusClass[status] || 'text-muted-foreground'} flex-shrink-0`}>
        {statusIcon[status] || '○'}
      </span>
      <span className={status === 'completed' ? 'line-through text-muted-foreground' : ''}>
        {title(item)}
      </span>
    </div>
  )
}

// ── TaskCreate / TaskUpdate: single-task input is reliable, render from it ──

export const taskWriteRenderer = {
  getPreview(tool: ToolCall): string {
    const input = tool.input as TaskItem & { status?: TaskStatus }
    const name = title(input)
    const label = statusLabel(input.status)
    if (name && label) return `${name} · ${label}`
    return name || label
  },
  renderInput(tool: ToolCall) {
    const input = tool.input as TaskItem & { status?: TaskStatus; description?: string }
    const name = title(input)
    if (!name && !input.status) return null
    return (
      <div className="space-y-0.5">
        <TaskLine item={input} />
        {input.description && (
          <div className="pl-3 text-tiny text-muted-foreground">{input.description}</div>
        )}
      </div>
    )
  },
  renderResult(): null {
    return null
  },
}

// ── TaskList / TaskGet: meaningful data is in the result ──

function parseTasks(result: ToolCall['result']): TaskItem[] | null {
  // Built-in tool results are usually raw JSON; MCP-wrapped text is the fallback.
  let parsed = safeParseResult<unknown>(result)
  if (typeof parsed === 'string') {
    const text = getMcpText(result)
    if (text) parsed = safeParseResult<unknown>(text)
  }
  if (Array.isArray(parsed)) return parsed as TaskItem[]
  if (parsed && typeof parsed === 'object') {
    const tasks = (parsed as { tasks?: unknown }).tasks
    if (Array.isArray(tasks)) return tasks as TaskItem[]
    if ('subject' in parsed || 'content' in parsed || 'id' in parsed) return [parsed as TaskItem]
  }
  return null
}

export const taskReadRenderer = {
  getPreview(): string {
    return ''
  },
  renderInput(): null {
    return null
  },
  renderResult(tool: ToolCall) {
    const tasks = parseTasks(tool.result)
    if (!tasks || !tasks.length) return null
    return (
      <div className="space-y-0.5">
        {tasks.map((t, i) => (
          <TaskLine key={t.id ?? i} item={t} />
        ))}
      </div>
    )
  },
}
