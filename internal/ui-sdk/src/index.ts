// @neutree-ai/ui-sdk — shared UI SDK for the agent platform. First module:
// agent session transcript rendering.

// ── Data layer ──
// ApiMessage/ApiContentPart are the wire input contract (structurally
// compatible with the platform's ApiMessageSchema); ChatMessage/ContentBlock/
// ToolCall are the render-ready shapes.
export type {
  ApiContentPart,
  ApiMessage,
  ChatMessage,
  ContentBlock,
  ToolCall,
} from './types'
export { toChatMessage } from './to-chat-message'

// ── Render components ──
export { Transcript } from './components/Transcript'
export type { TranscriptProps } from './components/Transcript'
export { MessageBubble } from './components/MessageBubble'
export { ToolCallBlock } from './components/ToolCallBlock'
export { TurnStatsBar } from './components/TurnStatsBar'
export { AgentTypeProvider, useAgentType } from './components/AgentTypeContext'
export {
  setSubAgentSessionLink,
  type SubAgentSessionLinkComponent,
} from './tool-renderers/sub-agent-session-link'

// ── Markdown injection ──
export { Markdown, MarkdownProvider, useMarkdown } from './markdown'
export type { MarkdownComponent, MarkdownProps } from './markdown'

// ── i18n ──
export { TranscriptI18nProvider, transcriptI18n } from './i18n'
export type { TranscriptI18nProviderProps } from './i18n'

// ── Lazy tool renderers (host-injectable; for on-demand plugin bundles) ──
export { LazyToolRenderersProvider, useLazyToolRenderers } from './lazy'
export type { LazyToolRenderers } from './lazy'

// ── Tool-renderer registry (for host-registered custom renderers) ──
export { resolveRenderer, getToolDisplayName } from './tool-renderers/registry'
export { registerToolRenderer } from './tool-renderers/plugin-registry'
export type { ToolRendererDef } from './tool-renderers/types'
// Helpers for authoring custom tool renderers.
export {
  safeParseResult,
  truncate,
  getMcpText,
  unwrapMcpInput,
  jsonPreview,
} from './tool-renderers/types'
