import { transcriptI18n as i18n } from '../../i18n'
import type { ToolCall, ToolRendererDef } from '../types'

/**
 * dsh's background-job tools: `job_list` ({}), `job_output`
 * ({job_id, wait?, timeout_ms?}), and `job_kill` ({job_id, reason?}).
 *
 * One renderer serves all three — the only thing worth lifting out of the
 * default JSON display is which job the call is about, since the card's own
 * label already says which of the three it is. Results are plain text (a job
 * table, a captured output chunk) and read fine as-is.
 */
export const dshJobRenderer: ToolRendererDef = {
  getPreview(tool: ToolCall): string {
    const id = tool.input.job_id
    if (!id) return ''
    const reason = tool.input.reason
    return reason ? `${String(id)} · ${String(reason)}` : String(id)
  },

  renderInput(tool: ToolCall) {
    const id = tool.input.job_id
    if (!id) return null
    const waiting = tool.input.wait === true
    return (
      <div className="space-y-0.5 text-tiny">
        <div className="font-mono text-foreground">{String(id)}</div>
        {waiting && (
          <div className="text-muted-foreground">
            {i18n.t('components.chat.toolRenderers.dshJobs.labels.waiting')}
          </div>
        )}
      </div>
    )
  },

  renderResult(): null {
    return null
  },
}
