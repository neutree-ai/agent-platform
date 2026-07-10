import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from 'react-i18next'

interface AgentSettingsEditorProps {
  value: string
  onChange: (value: string) => void
  agentType?: string
}

/**
 * Settings dialect per agent core. Explicit switch (not key concatenation) so
 * unknown/dev agent types degrade to no hint instead of leaking a raw i18n
 * key — `goose-dev` is the canary alias of `goose`.
 */
type SettingsKind = 'claude-code' | 'codex' | 'goose'

function settingsKind(agentType?: string): SettingsKind | null {
  switch (agentType) {
    case 'claude-code':
      return 'claude-code'
    case 'codex':
      return 'codex'
    case 'goose':
    case 'goose-dev':
      return 'goose'
    default:
      return null
  }
}

const PLACEHOLDERS: Record<SettingsKind, string> = {
  'claude-code': '{\n  "permissions": { "allow": [], "deny": [] }\n}',
  codex: 'model_context_window = 1000000\nmodel_auto_compact_token_limit = 900000',
  goose: 'GOOSE_AUTO_COMPACT_THRESHOLD: 0.6',
}

export function AgentSettingsEditor({ value, onChange, agentType }: AgentSettingsEditorProps) {
  const { t } = useTranslation()
  const kind = settingsKind(agentType)
  const placeholder = kind ? PLACEHOLDERS[kind] : '{}'
  let hint: string | undefined
  switch (kind) {
    case 'claude-code':
      hint = t('components.agentSettingsEditor.hints.claude-code')
      break
    case 'codex':
      hint = t('components.agentSettingsEditor.hints.codex')
      break
    case 'goose':
      hint = t('components.agentSettingsEditor.hints.goose')
      break
  }

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
