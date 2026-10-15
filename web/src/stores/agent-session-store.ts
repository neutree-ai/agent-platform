// The session store lives in the UI SDK
// (internal/ui-sdk/src/session/agent-session-store.ts), which the web app and
// third-party apps share; re-exported for the importers here. The web app's
// own parts — drafts, plugins — are given to it in AgentSessionContext.
export { createAgentSessionStore } from '@neutree-ai/ui-sdk'
export type {
  AgentSessionApi,
  AgentSessionDeps,
  AgentSessionEffects,
  AgentSessionSSE,
  AgentSessionSlice,
  ChatMessage,
  SSEHandlers,
  ToolCall,
} from '@neutree-ai/ui-sdk'
