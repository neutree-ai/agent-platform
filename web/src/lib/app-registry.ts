import type { ComponentType } from 'react'

/**
 * An app is a self-contained UI unit that can be hosted by any layout slot.
 * Apps don't know their position; the SlotContext binds them to slots.
 *
 * Component must be a stable reference (module-level export). Per-instance
 * state (cwd, scroll, expanded tree, draft) lives in the instance state
 * store keyed by `instanceId`, NOT in component-local useState — that way
 * slot moves / fill-mode toggles don't reset the user's view.
 */
export interface AppDefinition {
  id: string
  label: string
  Component: ComponentType<AppComponentProps>
  /** Greyed in dock and inert when picked (e.g., requires running ws). */
  disabled?: boolean
  /**
   * Picker grouping. Drives section heading + ordering in SlotPicker.
   * Categories follow user mental model rather than implementation scope:
   *   agent      — the agent itself (chat, sessions, memory, settings)
   *   tool       — hands-on surfaces operated directly (files, terminal, browser, sandboxes)
   *   capability — extending what the agent can do (skills, automation, library)
   *   connection — bridging external systems (integrations, providers, credentials)
   *   extension  — user-installed plugin apps (MCP-driven, domain-specific)
   *   system     — platform-level admin (admin)
   * Defaults to 'tool' when omitted.
   */
  group?: 'agent' | 'tool' | 'capability' | 'connection' | 'extension' | 'system'
  /**
   * Hidden apps don't appear in the dock or SlotPicker — they can only be
   * created programmatically (typically via `slotCtx.openInPopout`). Used
   * for purpose-built single-purpose viewers like the standalone file
   * preview that pairs with the regular Files browser.
   */
  hidden?: boolean
  /**
   * Optional small badge shown next to the label in app pickers (e.g., "alpha",
   * "beta"). Hint to users that the app is experimental or in early access.
   */
  badge?: string
  /**
   * Optional per-instance tab label. Receives the instance's persistent
   * state bag and returns a short string (e.g., basename of a file path).
   * Falls back to `label` when omitted or returning null. Used by the
   * popout tab strip to differentiate multiple instances of the same app.
   */
  instanceLabel?: (persistent: Record<string, unknown>) => string | null
}

export interface AppComponentProps {
  /**
   * Stable id assigned when the instance is created. Apps use it as the
   * scope key for any state that should outlive an unmount (layout
   * switch, fill-mode, slot move). Single-instance apps still get one —
   * just stable across the workspace lifetime.
   */
  instanceId: string
}

/**
 * One opened-app cell inside a slot. Multiple instances of the same app
 * (different `appId` matching, different `id`) coexist in the same or
 * different slots when `AppDefinition.multiInstance === true`.
 */
export interface AppInstance {
  id: string
  appId: string
}
