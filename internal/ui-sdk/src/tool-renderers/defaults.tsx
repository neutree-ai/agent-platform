import { useTranslation } from 'react-i18next'
import type { ToolCall } from './types'

export function DefaultInput({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="text-mini uppercase tracking-wide text-muted-foreground/70 mb-1">
        {t('components.chat.toolRenderers.defaults.input')}
      </div>
      <pre className="text-tiny bg-muted border border-foreground/[0.08] text-foreground/85 p-2 rounded-md overflow-x-auto">
        {JSON.stringify(tool.input, null, 2)}
      </pre>
    </div>
  )
}

export function DefaultResult({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="text-mini uppercase tracking-wide text-muted-foreground/70 mb-1">
        {t('components.chat.toolRenderers.defaults.result')}
      </div>
      <pre
        className={`text-tiny p-2 rounded-md border overflow-x-auto ${
          tool.isError
            ? 'bg-destructive/[0.06] border-destructive/20 text-destructive'
            : 'bg-muted border-foreground/[0.08] text-foreground/85'
        }`}
      >
        {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
      </pre>
    </div>
  )
}
