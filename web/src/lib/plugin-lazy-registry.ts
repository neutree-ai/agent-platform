/**
 * Lazy-plugin descriptor registries — one per surface (panel / tool
 * renderer / tool handler). Populated at boot from manifest entries that
 * declare `lazy: true`; consulted by the matching surface when it can't
 * find a real registration. Each surface independently calls
 * `ensurePluginLoaded(pluginId)` on its own trigger; this module knows
 * nothing about cross-surface coupling.
 *
 * Subscriptions wake consumers when a descriptor lands (manifest-fetch
 * is async; chat/launcher may render before manifest resolves).
 */

interface LazyPanelDescriptor {
  pluginId: string
  /** Static label shown in the app launcher / tab before the bundle's
   *  `registerPanel` lands its dynamic `label()` callback. */
  label: string
}

const lazyPanels = new Map<string, LazyPanelDescriptor>()
const lazyToolRenderers = new Map<string, string>() // toolName → pluginId
const lazyToolHandlers: { pattern: RegExp; pluginId: string }[] = []

const listeners = new Set<() => void>()
let version = 0

function bump(): void {
  version++
  for (const fn of listeners) fn()
}

export function registerLazyPanel(panelId: string, desc: LazyPanelDescriptor): void {
  lazyPanels.set(panelId, desc)
  bump()
}

export function registerLazyToolRenderer(toolName: string, pluginId: string): void {
  lazyToolRenderers.set(toolName, pluginId)
  bump()
}

export function registerLazyToolHandler(pattern: RegExp, pluginId: string): void {
  lazyToolHandlers.push({ pattern, pluginId })
  bump()
}

export function getLazyPanel(panelId: string): LazyPanelDescriptor | undefined {
  return lazyPanels.get(panelId)
}

export function getLazyToolRenderer(toolName: string): string | undefined {
  return lazyToolRenderers.get(toolName)
}

export function matchLazyToolHandlers(toolName: string): string[] {
  const hits: string[] = []
  for (const h of lazyToolHandlers) {
    if (h.pattern.test(toolName)) hits.push(h.pluginId)
  }
  return hits
}

/** `useSyncExternalStore`-style subscription so React consumers re-render
 *  when descriptors land. Eager plugins don't touch this. */
export function subscribeLazyRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLazyRegistryVersion(): number {
  return version
}
