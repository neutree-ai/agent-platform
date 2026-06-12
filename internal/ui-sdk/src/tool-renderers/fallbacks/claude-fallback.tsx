import { type ToolCall, jsonPreview } from '../types'

export const claudeFallback = {
  getPreview(tool: ToolCall): string {
    return jsonPreview(tool.input)
  },
  renderInput(): null {
    return null
  },
  renderResult(): null {
    return null
  },
}
