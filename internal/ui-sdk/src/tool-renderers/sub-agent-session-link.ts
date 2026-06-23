import type { ComponentType } from 'react'

/**
 * Renders a sub-agent's session id (from a call_agent result).
 *
 * The SDK has no notion of routing or workspace ownership, so the host app
 * injects an implementation that can turn the id into a link — resolving the
 * agent and navigating to its session. When nothing is injected (or the session
 * isn't reachable), the call_agent renderer falls back to plain text.
 *
 * Injected once at app startup via `setSubAgentSessionLink`. The component only
 * mounts when a call_agent card is expanded, so any data fetching it does stays
 * lazy and scoped to the renderer.
 */
export type SubAgentSessionLinkComponent = ComponentType<{ slug: string; sessionId: string }>

let impl: SubAgentSessionLinkComponent | null = null

export function setSubAgentSessionLink(component: SubAgentSessionLinkComponent | null): void {
  impl = component
}

export function getSubAgentSessionLink(): SubAgentSessionLinkComponent | null {
  return impl
}
