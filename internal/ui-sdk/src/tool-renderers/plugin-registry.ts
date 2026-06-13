/**
 * Tool-renderer registry — module-level singleton consulted after the
 * built-in renderer table. Plugins register custom renderers for their
 * MCP tools at boot via `window.tos.registerToolRenderer(name, def)`.
 *
 * Version + subscription let lazy-plugin consumers (ToolCallBlock)
 * re-render when a bundle lands after first paint, replacing their
 * skeleton placeholder with the real card.
 */

import type { ToolRendererDef } from './types'

const renderers = new Map<string, ToolRendererDef>()
const listeners = new Set<() => void>()
let version = 0

export function registerToolRenderer(name: string, def: ToolRendererDef): void {
  if (renderers.has(name)) {
    console.warn(`[plugins] duplicate tool renderer for: ${name}`)
    return
  }
  renderers.set(name, def)
  version++
  for (const fn of listeners) fn()
}

export function getPluginToolRenderer(name: string): ToolRendererDef | undefined {
  return renderers.get(name)
}

/** Subscribe to renderer registrations. Returns unsubscribe fn. */
export function subscribeToolRenderers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Monotonic snapshot for useSyncExternalStore. */
export function getToolRenderersVersion(): number {
  return version
}
