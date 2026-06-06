import { AgentSettingsEditor } from '../AgentSettingsEditor'
import { FieldHint, jsonEqual } from './FieldHint'

interface SettingsSectionProps {
  agentSettings: string
  onChange: (settings: string) => void
  onRevert?: () => void
  templateConfig?: { agent_settings: string } | null
  agentType?: string
}

export function SettingsSection({
  agentSettings,
  onChange,
  onRevert,
  templateConfig,
  agentType,
}: SettingsSectionProps) {
  return (
    <div className="space-y-2">
      <AgentSettingsEditor value={agentSettings} onChange={onChange} agentType={agentType} />
      <FieldHint
        current={agentSettings}
        template={templateConfig?.agent_settings}
        onRevert={() => onRevert?.()}
        compare={jsonEqual}
      />
    </div>
  )
}
