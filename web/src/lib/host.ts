/**
 * Plugin host — the single global surface (`window.tos`) that external
 * plugins consume at runtime. Plugins are IIFE bundles loaded after this
 * module has run; sharing React from here is mandatory (the rules of hooks
 * require a single React instance).
 *
 * Surface is intentionally minimal. New entries land here only when a real
 * plugin needs a piece of host state or logic that it cannot reasonably
 * reimplement (heavy nap-specific behavior — agent session state, workspace
 * file overlay, the workspace markdown renderer with file/link integration).
 * Presentation-layer libraries (shadcn, Radix, lucide, zustand, i18n) and
 * any nap-domain API plugins are responsible for themselves; the host does
 * not dictate UI style or own per-domain API surface.
 */

import {
  getMcpText,
  jsonPreview,
  safeParseResult,
  truncate,
  unwrapMcpInput,
} from '@/components/chat/tool-renderers/types'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Markdown } from '@/components/ui/markdown'
import { useSlotContext } from '@/contexts/SlotContext'
import { registerPlugin } from '@/plugins/registry'
import type { WorkspacePlugin } from '@/plugins/types'
import { useAgentSessionActions, useAgentSessionStore } from '@/stores/AgentSessionContext'
import { useInstancePersistentState, useInstanceState } from '@/stores/instance-state-store'
import i18n from 'i18next'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import { useResolvedTheme } from '@neutree-ai/theme'
import { events } from './host-events'
import { type PluginPanel, registerPanel } from './panel-registry'
import { registerToolRenderer } from './tool-renderer-registry'

interface TosHost {
  version: string
  React: typeof React
  ReactDOM: typeof ReactDOM
  ReactJSXRuntime: typeof ReactJSXRuntime
  registerPlugin: (plugin: WorkspacePlugin) => void
  registerPanel: (panel: PluginPanel) => void
  registerToolRenderer: typeof registerToolRenderer
  events: typeof events
  ui: {
    Markdown: typeof Markdown
    useResolvedTheme: typeof useResolvedTheme
  }
  workspace: {
    useSlotContext: typeof useSlotContext
    useAgentSessionActions: typeof useAgentSessionActions
    useAgentSessionStore: typeof useAgentSessionStore
    useInstanceState: typeof useInstanceState
    useInstancePersistentState: typeof useInstancePersistentState
  }
  windows: {
    useAppHeaderSlot: typeof useAppHeaderSlot
    AppHeaderButton: typeof AppHeaderButton
  }
  tools: {
    getMcpText: typeof getMcpText
    unwrapMcpInput: typeof unwrapMcpInput
    safeParseResult: typeof safeParseResult
    truncate: typeof truncate
    jsonPreview: typeof jsonPreview
  }
}

declare global {
  interface Window {
    tos?: TosHost
  }
}

export function installHost(): void {
  const host: TosHost = {
    version: '1.0.0',
    React,
    ReactDOM,
    ReactJSXRuntime,
    registerPlugin,
    registerPanel,
    registerToolRenderer,
    events,
    ui: { Markdown, useResolvedTheme },
    workspace: {
      useSlotContext,
      useAgentSessionActions,
      useAgentSessionStore,
      useInstanceState,
      useInstancePersistentState,
    },
    windows: { useAppHeaderSlot, AppHeaderButton },
    tools: { getMcpText, unwrapMcpInput, safeParseResult, truncate, jsonPreview },
  }
  window.tos = host

  // Bridge host i18next language changes to the events bus so plugins with
  // their own i18next instance can stay in sync without import-coupling.
  i18n.on('languageChanged', (lng) => events.emit('lang.change', lng))
}
