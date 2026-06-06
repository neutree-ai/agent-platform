import { codexEditRenderer } from '../codex/edit'
import { codexExecRenderer, isCodexExec } from '../codex/exec'
import type { ToolCall } from '../types'
import { jsonPreview } from '../types'

/**
 * Codex fallback: routes to the appropriate renderer based on input structure.
 * Codex tool names are dynamic ("Run echo hello", "Edit /tmp/test.txt"),
 * so we detect tool type from input fields instead. Because later
 * tool_call_updates can overwrite rawInput to `{}`, detection also falls
 * back to inspecting the parsed result payload (Codex exec's rawOutput
 * duplicates command/parsed_cmd/exit_code).
 */
export const codexFallback = {
  getPreview(tool: ToolCall): string {
    if (tool.input.changes) return codexEditRenderer.getPreview(tool)
    if (isCodexExec(tool)) return codexExecRenderer.getPreview(tool)
    return jsonPreview(tool.input)
  },

  renderInput(tool: ToolCall) {
    if (tool.input.changes) return codexEditRenderer.renderInput(tool)
    if (isCodexExec(tool)) return codexExecRenderer.renderInput(tool)
    return null
  },

  renderResult(tool: ToolCall) {
    if (tool.input.changes) return codexEditRenderer.renderResult(tool)
    if (isCodexExec(tool)) return codexExecRenderer.renderResult(tool)
    return null
  },
}
