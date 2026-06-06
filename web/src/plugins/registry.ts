/**
 * Plugin registry — module-level singleton.
 *
 * Plugins register at app startup; the agent-session store creates a
 * per-store dispatcher whose lifetime mirrors the store. Debounce timers
 * live in the dispatcher so destroying a store cancels pending bumps.
 */

import { registerPanel } from '@/lib/panel-registry'
import { matchLazyToolHandlers } from '@/lib/plugin-lazy-registry'
import { ensurePluginLoaded } from '@/lib/plugin-loader'
import type { ToolMatchCtx, ToolResultHandler, WorkspacePlugin } from './types'

const handlers: ToolResultHandler[] = []
const seenHandlerIds = new Set<string>()

export function registerPlugin(plugin: WorkspacePlugin): void {
  for (const h of plugin.toolResultHandlers ?? []) {
    if (seenHandlerIds.has(h.id)) {
      console.warn(`[plugins] duplicate tool-result handler id: ${h.id}`)
      continue
    }
    seenHandlerIds.add(h.id)
    handlers.push(h)
  }
  for (const panel of plugin.panels ?? []) {
    registerPanel(panel)
  }
}

/** Test helper — clears all registered handlers. */
export function _resetPluginsForTests(): void {
  handlers.length = 0
  seenHandlerIds.clear()
}

export function createToolResultDispatcher() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function dispatch(ctx: ToolMatchCtx): void {
    // Lazy plugins: a matching tool name triggers a load, but the
    // current event is dropped — the bundle's `registerPlugin` will
    // pick up subsequent matching events. Accepted miss; see
    // plugin-lazy-registry.ts for the design rationale.
    for (const pluginId of matchLazyToolHandlers(ctx.toolName)) {
      ensurePluginLoaded(pluginId).catch(() => {})
    }
    for (const h of handlers) {
      if (!h.match(ctx)) continue
      if (h.debounceMs) {
        const existing = timers.get(h.id)
        if (existing) clearTimeout(existing)
        timers.set(
          h.id,
          setTimeout(() => {
            timers.delete(h.id)
            h.onMatch(ctx)
          }, h.debounceMs),
        )
      } else {
        h.onMatch(ctx)
      }
    }
  }

  function destroy(): void {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }

  return { dispatch, destroy }
}
