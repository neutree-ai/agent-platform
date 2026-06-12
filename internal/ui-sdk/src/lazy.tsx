// Host-injectable bridge for lazily-loaded tool renderers.
//
// When the synchronous registry has no renderer for a tool, the SDK asks this
// source (if a host provides one) whether a lazily-loadable plugin owns the
// renderer; if so it shows a skeleton and triggers the load. The loaded bundle
// registers via registerToolRenderer and the component re-renders with the real
// card. Hosts with only eager plugins — or none at all — simply omit the
// provider, and ToolCallBlock falls back to the default renderer.
import { type ReactNode, createContext, useContext } from 'react'

export interface LazyToolRenderers {
  /** Plugin id that lazily owns this tool's renderer, or undefined. */
  getPluginId(toolName: string): string | undefined
  /** Trigger the plugin bundle load (idempotent). */
  load(pluginId: string): Promise<void>
  /** Subscribe to lazy-descriptor registry changes (re-render after a late register). */
  subscribe?(listener: () => void): () => void
  /** Monotonic version for useSyncExternalStore. */
  getVersion?(): number
}

const LazyToolRenderersContext = createContext<LazyToolRenderers | null>(null)

export function LazyToolRenderersProvider({
  value,
  children,
}: {
  value: LazyToolRenderers
  children: ReactNode
}) {
  return (
    <LazyToolRenderersContext.Provider value={value}>{children}</LazyToolRenderersContext.Provider>
  )
}

export function useLazyToolRenderers(): LazyToolRenderers | null {
  return useContext(LazyToolRenderersContext)
}
