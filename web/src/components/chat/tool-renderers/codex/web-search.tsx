import i18n from '@/lib/i18n'
import type { ToolRendererDef } from '../types'

/**
 * Codex emits web_search tool calls as `{ title: "Searching the Web" }` with
 * empty rawInput/rawOutput/content — no query, no results. Keep the original
 * tool title as header; suppress the empty `{}` input and show a minimal
 * placeholder for the missing result payload.
 */
export const codexWebSearchRenderer: ToolRendererDef = {
  getPreview(): string {
    return ''
  },

  renderInput() {
    return <div />
  },

  renderResult() {
    return (
      <div className="text-mini text-muted-foreground">
        {i18n.t('components.chat.toolRenderers.codexWebSearch.empty')}
      </div>
    )
  },
}
