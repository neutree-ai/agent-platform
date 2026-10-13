// @neutree-ai/ui-sdk — shared UI SDK for the agent platform: agent session
// transcript rendering and the chat composer.

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
export { ToolCallGroup } from './components/ToolCallGroup'
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

// ── Composer ──
// Network-free chat input; data sources (commands, @-triggers, voice) come in
// through props.
export { Composer } from './composer/Composer'
export type {
  ComposerAttachments,
  ComposerCommand,
  ComposerHandle,
  ComposerImageAttachment,
  ComposerPending,
  ComposerProps,
  ComposerTrigger,
  ComposerTriggerItem,
  ComposerVoice,
} from './composer/types'
export { shouldSubmitOnKey, type ComposerSendKey } from './composer/keys'
export { parseTemplateVariables, resolveTemplate } from './composer/text'
// Hosts without their own Radix tooltip provider wrap the app in this one.
export { TooltipProvider } from './ui/tooltip'

// ── Platform composer preset ──
// Built-in + workspace commands, @file / @agent mentions and voice, over an
// injected client.
export {
  NAP_BUILTIN_COMMAND_NAMES,
  createNapComposerPreset,
  isNapBuiltinCommandSupported,
  useNapComposer,
} from './nap-composer/preset'
export type {
  NapBuiltinCommandName,
  NapComposerInclude,
  NapComposerOptions,
  NapComposerPreset,
} from './nap-composer/preset'
export { createNapHttpClient } from './nap-composer/client'
export type {
  NapCallableAgent,
  NapComposerClient,
  NapDirEntry,
  NapHttpClientOptions,
  NapTranscribeOptions,
  NapWorkspaceCommand,
} from './nap-composer/client'
