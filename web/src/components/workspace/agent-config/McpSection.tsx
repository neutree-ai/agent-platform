import { McpConfigEditor } from '@/components/workspace/McpConfigEditor'
import { FieldHint, jsonEqual } from './FieldHint'

interface McpSectionProps {
  mcpConfig: string
  onChange: (mcpConfig: string) => void
  onRevert?: () => void
  templateConfig?: { mcp_config: string } | null
  workspaceId?: string
}

export function McpSection({
  mcpConfig,
  onChange,
  onRevert,
  templateConfig,
  workspaceId,
}: McpSectionProps) {
  return (
    <div className="space-y-3">
      <McpConfigEditor value={mcpConfig} onChange={onChange} workspaceId={workspaceId} />
      <FieldHint
        current={mcpConfig}
        template={templateConfig?.mcp_config}
        onRevert={() => onRevert?.()}
        compare={jsonEqual}
      />
    </div>
  )
}
