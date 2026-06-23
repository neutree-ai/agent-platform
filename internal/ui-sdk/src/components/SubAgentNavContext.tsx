import { createContext, useContext } from 'react'

/**
 * Lets the call_agent tool renderer offer a "jump to sub-agent session" link
 * without the SDK knowing about routing or workspace ownership.
 *
 * The host (the app) decides whether a sub-agent's session is reachable. Today
 * only the user's OWN agents qualify: their session lives in a workspace the
 * user owns, so the normal workspace route can load it. Another user's public
 * agent runs in a workspace the user can't open, so `canOpen` returns false and
 * the renderer falls back to plain text.
 *
 * When no provider is mounted (e.g. the public share page), the default makes
 * every session non-clickable.
 */
export interface SubAgentNav {
  /** Whether a jump link should be shown for the agent addressed by `slug`. */
  canOpen(slug: string): boolean
  /** Open the sub-agent's session. Only called when `canOpen(slug)` is true. */
  open(slug: string, sessionId: string): void
}

const noop: SubAgentNav = { canOpen: () => false, open: () => {} }

const SubAgentNavContext = createContext<SubAgentNav>(noop)

export const SubAgentNavProvider = SubAgentNavContext.Provider

export function useSubAgentNav(): SubAgentNav {
  return useContext(SubAgentNavContext)
}
