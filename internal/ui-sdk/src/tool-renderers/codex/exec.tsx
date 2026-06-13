import { transcriptI18n as i18n } from '../../i18n'
import { type ToolCall, safeParseResult, truncate } from '../types'
import type { ToolRendererDef } from '../types'

interface ParsedCmd {
  type: string
  cmd: string
  name?: string
  path?: string
}

interface ExecResult {
  call_id?: string
  process_id?: string
  command?: string[]
  cwd?: string
  parsed_cmd?: ParsedCmd[]
  stdout?: string
  stderr?: string
  aggregated_output?: string
  formatted_output?: string
  exit_code?: number
  status?: string
}

/**
 * Merge metadata from tool.input and (if parseable) tool.result.
 * Codex rawOutput duplicates all input metadata (command, parsed_cmd, cwd),
 * so when rawInput gets overwritten to `{}` by later updates we can still
 * recover the command/path from the result.
 */
function getExecMetadata(tool: ToolCall): ExecResult {
  const fromResult = safeParseResult<ExecResult>(tool.result)
  const meta: ExecResult = fromResult && typeof fromResult === 'object' ? { ...fromResult } : {}
  const input = tool.input as Partial<ExecResult>
  if (input.command) meta.command = input.command
  if (input.parsed_cmd) meta.parsed_cmd = input.parsed_cmd
  if (input.cwd) meta.cwd = input.cwd
  return meta
}

function getExecCommand(input: Record<string, unknown>): string | null {
  if (typeof input.cmd === 'string') return input.cmd
  if (Array.isArray(input.command)) {
    const cmd = input.command as string[]
    if (cmd.length === 3 && cmd[0]?.endsWith('/bash') && cmd[1] === '-lc') return cmd[2]
    return cmd.join(' ')
  }
  return null
}

/**
 * Detect a Codex exec tool from *either* input or parsed result.
 * Needed because input can be overwritten to `{}` by later tool_call_updates.
 */
export function isCodexExec(tool: ToolCall): boolean {
  if (getExecCommand(tool.input) != null) return true
  const parsed = safeParseResult<ExecResult>(tool.result)
  if (!parsed || typeof parsed !== 'object') return false
  return (
    Array.isArray(parsed.command) ||
    Array.isArray(parsed.parsed_cmd) ||
    typeof parsed.exit_code === 'number' ||
    typeof parsed.process_id === 'string'
  )
}

function getParsedCmd(input: Record<string, unknown>): ParsedCmd | null {
  const arr = input.parsed_cmd as ParsedCmd[] | undefined
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
}

function formatCommand(command: string[] | undefined): string | null {
  if (!Array.isArray(command) || command.length === 0) return null
  if (command.length === 3 && command[0]?.endsWith('/bash') && command[1] === '-lc')
    return command[2]
  return command.join(' ')
}

export const codexExecRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const cmd = getExecCommand(tool.input) ?? formatCommand(getExecMetadata(tool).command)
    return cmd ? truncate(cmd) : ''
  },

  renderInput(tool: ToolCall) {
    const meta = getExecMetadata(tool)
    const parsed = getParsedCmd(tool.input) ?? meta.parsed_cmd?.[0] ?? null
    const cmd = getExecCommand(tool.input) ?? formatCommand(meta.command)
    if (!cmd && !parsed) return <div />
    const cwd = String(tool.input.cwd || meta.cwd || '')

    if (parsed?.type === 'read' && parsed.name) {
      return (
        <div className="space-y-0.5">
          <div className="font-mono text-tiny text-foreground">{parsed.path || parsed.name}</div>
          {cwd && (
            <div className="text-mini text-muted-foreground">
              {i18n.t('components.chat.toolRenderers.codexExec.labels.inPath', { value: cwd })}
            </div>
          )}
        </div>
      )
    }

    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {i18n.t('components.chat.toolRenderers.codexExec.labels.command')}
        </div>
        <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto font-mono">
          {cmd}
        </pre>
        {cwd && (
          <div className="text-mini text-muted-foreground mt-1">
            {i18n.t('components.chat.toolRenderers.codexExec.labels.cwd', { value: cwd })}
          </div>
        )}
      </div>
    )
  },

  renderResult(tool: ToolCall) {
    const parsed = safeParseResult<ExecResult>(tool.result)

    // Plain-text result (older shape, or streaming intermediate snapshot):
    // just display it as stdout-style output.
    if (typeof parsed === 'string') {
      return (
        <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto max-h-60 overflow-y-auto">
          {parsed}
        </pre>
      )
    }
    if (!parsed || typeof parsed !== 'object') return <div />

    const stdout = parsed.stdout ?? parsed.aggregated_output ?? ''
    const stderr = parsed.stderr ?? ''

    return (
      <div className="space-y-1">
        {stdout && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              {i18n.t('components.chat.toolRenderers.codexExec.labels.stdout')}
            </div>
            <pre className="text-tiny bg-muted border border-foreground/[0.08] p-2 rounded-md overflow-x-auto max-h-60 overflow-y-auto">
              {stdout}
            </pre>
          </div>
        )}
        {stderr && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              {i18n.t('components.chat.toolRenderers.codexExec.labels.stderr')}
            </div>
            <pre className="text-tiny bg-destructive/10 p-2 rounded overflow-x-auto max-h-60 overflow-y-auto">
              {stderr}
            </pre>
          </div>
        )}
        {parsed.exit_code !== undefined && parsed.exit_code !== 0 && (
          <div className="text-mini text-destructive">
            {i18n.t('components.chat.toolRenderers.codexExec.labels.exitCode', {
              value: parsed.exit_code,
            })}
          </div>
        )}
      </div>
    )
  },
}
