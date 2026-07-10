import type { ReactNode } from 'react'
import type { ToolCall } from '../types'

export type { ToolCall }

/**
 * Renderer definition for a single tool or tool group.
 * Return null from renderInput/renderResult to fall back to the default JSON display.
 */
export interface ToolRendererDef {
  getPreview(tool: ToolCall): string
  renderInput(tool: ToolCall): ReactNode | null
  renderResult(tool: ToolCall): ReactNode | null
  /**
   * If true, the tool card opens expanded by default (e.g. propose cards that
   * carry an Approve/Reject action — the user shouldn't have to click to see
   * what they're approving). The user can still collapse manually.
   */
  defaultExpanded?: boolean
}

/**
 * Safely parse tool.result (which is usually a raw JSON string) into a typed object.
 * Returns the parsed object on success, or the original value on failure.
 */
export function safeParseResult<T = unknown>(
  result: string | object | undefined,
): T | string | undefined {
  if (result == null) return undefined
  if (typeof result !== 'string') return result as T
  try {
    return JSON.parse(result) as T
  } catch {
    return result
  }
}

/** Truncate a string for preview display. */
export function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * Extract text from MCP tool result.
 * Handles:
 *  - CC MCP:      [{"type":"text","text":"..."}]
 *  - Codex MCP:   {"content":[{"type":"text","text":"..."}]}
 *  - Codex `execute(server, tool, arguments)` dispatcher: wraps the real
 *    CallToolResult one level deeper, as {"result":{"content":[...]},"error":null}
 *  - Goose MCP:   the acp-adapter stores the content text directly, so the
 *    result is already the unwrapped payload (bare JSON or plain text) —
 *    when no known wrapper matches, return the raw string as-is.
 */
export function getMcpText(result: string | object | undefined): string | null {
  const parsed = safeParseResult<unknown>(result)
  if (!parsed) return null
  // Plain text that isn't JSON — already the final payload (goose).
  if (typeof parsed === 'string') return parsed
  // Direct array: [{"type":"text","text":"..."}]
  if (Array.isArray(parsed)) {
    const first = parsed[0]
    if (first && typeof first === 'object' && 'text' in first)
      return (first as { text: string }).text
    return null
  }
  if (typeof parsed !== 'object') return null
  const container =
    'content' in parsed
      ? parsed
      : 'result' in parsed && typeof (parsed as { result: unknown }).result === 'object'
        ? (parsed as { result: object }).result
        : parsed
  // Wrapped: {"content":[{"type":"text","text":"..."}]}
  if (container && typeof container === 'object' && 'content' in container) {
    const content = (container as { content: unknown }).content
    if (
      Array.isArray(content) &&
      content[0] &&
      typeof content[0] === 'object' &&
      'text' in content[0]
    ) {
      return (content[0] as { text: string }).text
    }
  }
  // No recognized wrapper: the stored result is already the unwrapped
  // payload (goose path — the acp-adapter persists the content text itself).
  return typeof result === 'string' ? result : null
}

/**
 * Unwrap Codex MCP input format.
 * Codex wraps MCP calls as {server, tool, arguments: {actual input}}.
 * Returns the inner arguments if present, otherwise the input itself.
 */
export function unwrapMcpInput(input: Record<string, unknown>): Record<string, unknown> {
  if (
    input.server &&
    input.tool &&
    typeof input.arguments === 'object' &&
    input.arguments !== null
  ) {
    return input.arguments as Record<string, unknown>
  }
  return input
}

/** Default JSON preview for tool inputs without a custom getPreview. */
export function jsonPreview(input: Record<string, unknown>, max = 120): string {
  try {
    const raw = JSON.stringify(input)
    return !raw || raw === '{}' ? '' : truncate(raw, max)
  } catch {
    return ''
  }
}
