import { McpConfigEditor } from '@/components/workspace/McpConfigEditor'
import { FieldHint, jsonEqual } from './FieldHint'

interface McpSectionProps {
  mcpConfig: string
  onChange: (mcpConfig: string) => void
  onRevert?: () => void
  templateConfig?: { mcp_config: string } | null
  workspaceId?: string
  /** MCP OAuth connects as the workspace owner; set for team members. */
  oauthOwnerOnly?: boolean
}

export function McpSection({
  mcpConfig,
  onChange,
  onRevert,
  templateConfig,
  workspaceId,
  oauthOwnerOnly,
}: McpSectionProps) {
  return (
    <div className="space-y-3">
      <McpConfigEditor
        value={mcpConfig}
        onChange={onChange}
        workspaceId={workspaceId}
        oauthOwnerOnly={oauthOwnerOnly}
      />
      <FieldHint
        current={mcpConfig}
        template={templateConfig?.mcp_config}
        onRevert={() => onRevert?.()}
        compare={jsonEqual}
      />
    </div>
  )
}
