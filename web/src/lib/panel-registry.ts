import type { ComponentType } from 'react'

interface PluginPanelProps {
  workspaceId: string
  instanceId: string
}

export interface PluginPanel {
  /** Panel id, matching a panel the plugin declares in its manifest
   *  (`owns.panels[].id`). The workspace shows it when the plugin is
   *  installed there — see useWsApps / workspace_plugins. */
  id: string
  /** Returns the localized tab label. Called every render so plugins with
   *  their own i18next instance can react to language changes (the host
   *  bridges `languageChanged` to the `lang.change` event bus). */
  label: () => string
  component: ComponentType<PluginPanelProps>
}

const panels = new Map<string, PluginPanel>()

// Remote plugin bundles register their panels asynchronously (after their
// IIFE script finishes loading), which can land after the app launcher has
// already computed its app list. Expose a subscribe/notify surface so
// consumers (useWsApps) can re-run when a panel registers late instead of
// silently dropping the entry until a full refresh.
const listeners = new Set<() => void>()
// Bumped on every registration; serves as the useSyncExternalStore snapshot.
let version = 0

export function registerPanel(panel: PluginPanel): void {
  if (panels.has(panel.id)) {
    console.warn(`[plugins] duplicate panel id: ${panel.id}`)
    return
  }
  panels.set(panel.id, panel)
  version++
  for (const fn of listeners) fn()
}

export function getPanel(id: string): PluginPanel | undefined {
  return panels.get(id)
}

/** Subscribe to panel registrations; returns an unsubscribe fn. */
export function subscribePanels(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Monotonic snapshot for useSyncExternalStore — changes on each register. */
export function getPanelsVersion(): number {
  return version
}
