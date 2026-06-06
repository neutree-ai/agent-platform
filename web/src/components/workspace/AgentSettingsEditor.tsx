import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from 'react-i18next'

interface AgentSettingsEditorProps {
  value: string
  onChange: (value: string) => void
  agentType?: string
}

const PLACEHOLDERS: Record<string, string> = {
  'claude-code': '{\n  "permissions": { "allow": [], "deny": [] }\n}',
  codex: 'model_context_window = 1000000\nmodel_auto_compact_token_limit = 900000',
}

export function AgentSettingsEditor({ value, onChange, agentType }: AgentSettingsEditorProps) {
  const { t } = useTranslation()
  const placeholder = (agentType && PLACEHOLDERS[agentType]) || '{}'
  const hint = agentType ? t(`components.agentSettingsEditor.hints.${agentType}`) : undefined

  return (
    <div className="space-y-1">
      <Textarea
        className="min-h-[200px] font-mono text-xs focus-visible:ring-inset"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <p className="text-mini text-muted-foreground">{hint}</p>}
    </div>
  )
}
