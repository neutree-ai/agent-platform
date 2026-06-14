import {
  AdminApp,
  AutomationApp,
  BrowserApp,
  ChatApp,
  ConnectorsApp,
  CredentialsApp,
  FileApp,
  FilesApp,
  LibraryApp,
  MemoryApp,
  ModelsApp,
  OAuthAppsApp,
  SandboxApp,
  ServiceTokensApp,
  SessionsApp,
  SettingsApp,
  SkillsApp,
  TeamsApp,
  TerminalApp,
  getPluginApp,
} from '@/components/shell/apps/wsApps'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { api } from '@/lib/api/client'
import type { WorkspacePluginEntry } from '@/lib/api/types'
import type { AppDefinition } from '@/lib/app-registry'
import { getPanel, getPanelsVersion, subscribePanels } from '@/lib/panel-registry'
import {
  getLazyPanel,
  getLazyRegistryVersion,
  subscribeLazyRegistry,
} from '@/lib/plugin-lazy-registry'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Resolves the AppDefinition list for a workspace. Built-ins come first;
 * plugin apps (the UI plugins installed in this ws) come last.
 *
 * `disabled` flags reflect ws.status — disabled apps still render (so an
 * already-active disabled app shows its own NotRunning state), but the
 * dock dims them and the picker should hide them.
 */
export function useWsApps(workspaceId: string | undefined): AppDefinition[] {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: workspaces } = useWorkspaces()
  const ws = workspaces?.find((w) => w.id === workspaceId)
  // Installed UI plugins for this workspace — the visibility source for
  // extension apps. Decoupled from mcp_config: a plugin shows because it's
  // installed here, not because a same-id MCP server is enabled.
  const { data: wsPlugins } = useQuery<WorkspacePluginEntry[]>({
    queryKey: ['workspace-plugins', workspaceId],
    queryFn: () => api.getWorkspacePlugins(workspaceId ?? ''),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  })
  // Re-run the memo when a plugin panel registers after first render — remote
  // plugin bundles (e.g. reviewdeck) register asynchronously, and without this
  // their app launcher entry stays missing until a full refresh.
  const panelsVersion = useSyncExternalStore(subscribePanels, getPanelsVersion)
  // Same trigger for lazy-plugin descriptors: their tab needs to appear
  // in the launcher before the bundle loads, and the descriptor map is
  // populated asynchronously by the manifest fetch.
  const lazyVersion = useSyncExternalStore(subscribeLazyRegistry, getLazyRegistryVersion)

  // panelsVersion is intentionally a dep — it isn't read in the body but bumps
  // when a plugin panel registers late, forcing the app list to recompute.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  return useMemo(() => {
    if (!workspaceId) return []
    const notRunning = ws?.status !== 'running'
    const apps: AppDefinition[] = []

    // Push order within a group is preserved by SlotPicker, so put each app
    // where the user expects to find it in its column. Cross-group order
    // doesn't matter for the picker (GROUP_ORDER takes over there).

    // Agent — the agent itself (chat, history, memory, settings)
    apps.push({
      id: 'chat',
      label: t('pages.workspace.tabs.chat'),
      Component: ChatApp,
      group: 'agent',
    })
    apps.push({
      id: 'sessions',
      label: t('pages.workspace.tabs.sessions'),
      Component: SessionsApp,
      group: 'agent',
    })
    apps.push({
      id: 'memory',
      label: t('pages.workspace.tabs.memoryStores'),
      Component: MemoryApp,
      group: 'agent',
    })
    apps.push({
      id: 'settings',
      label: t('pages.workspace.tabs.settings'),
      Component: SettingsApp,
      group: 'agent',
    })

    // Tools
    apps.push({
      id: 'files',
      label: t('pages.workspace.tabs.files'),
      Component: FilesApp,
      disabled: notRunning,
      group: 'tool',
    })
    apps.push({
      id: 'terminal',
      label: t('pages.workspace.tabs.terminal'),
      Component: TerminalApp,
      disabled: notRunning,
      group: 'tool',
    })
    apps.push({
      id: 'browser',
      label: t('pages.workspace.tabs.browser'),
      Component: BrowserApp,
      group: 'tool',
    })
    apps.push({
      id: 'sandboxes',
      label: t('pages.workspace.tabs.sandboxes'),
      Component: SandboxApp,
      group: 'tool',
    })

    // Capability
    apps.push({
      id: 'skills',
      label: t('pages.workspace.tabs.skills'),
      Component: SkillsApp,
      disabled: notRunning,
      group: 'capability',
    })
    apps.push({
      id: 'automation',
      label: t('pages.workspace.tabs.automation'),
      Component: AutomationApp,
      group: 'capability',
    })
    apps.push({
      id: 'library',
      label: t('pages.workspace.tabs.library'),
      Component: LibraryApp,
      group: 'capability',
    })

    // Connection
    apps.push({
      id: 'connectors',
      label: t('pages.workspace.tabs.connectors'),
      Component: ConnectorsApp,
      group: 'connection',
    })
    apps.push({
      id: 'service-tokens',
      label: t('pages.workspace.tabs.serviceTokens'),
      Component: ServiceTokensApp,
      group: 'connection',
    })
    apps.push({
      id: 'credentials',
      label: t('pages.workspace.tabs.credentials'),
      Component: CredentialsApp,
      group: 'connection',
    })

    // System — platform-level config. Model Providers is here because it
    // sets up *available* model providers that Settings then picks from.
    apps.push({
      id: 'models',
      label: t('pages.workspace.tabs.models'),
      Component: ModelsApp,
      group: 'system',
    })
    apps.push({
      id: 'teams',
      label: t('pages.workspace.tabs.teams'),
      Component: TeamsApp,
      group: 'system',
    })
    apps.push({
      id: 'oauth-apps',
      label: t('pages.workspace.tabs.oauthApps'),
      Component: OAuthAppsApp,
      group: 'system',
    })
    if (user?.role === 'admin') {
      apps.push({
        id: 'admin',
        label: t('pages.workspace.tabs.admin'),
        Component: AdminApp,
        group: 'system',
      })
    }

    // Hidden — created only via openInPopout('file', ...)
    apps.push({
      id: 'file',
      label: t('pages.workspace.tabs.file'),
      Component: FileApp,
      disabled: notRunning,
      hidden: true,
      instanceLabel: (p) => {
        const path = typeof p.viewingPath === 'string' ? p.viewingPath : ''
        if (!path) return null
        const stripped = path.endsWith('/') ? path.slice(0, -1) : path
        return decodeURIComponent(stripped.split('/').pop() || stripped)
      },
    })

    // Extensions — UI plugins installed in this workspace. One app per
    // owned panel; the install record (not MCP enablement) gates visibility.
    for (const plugin of wsPlugins ?? []) {
      for (const decl of plugin.panels) {
        // Three states for the panel:
        //  - registered (bundle loaded): use its label() — supports i18n
        //  - lazy descriptor only: use the static manifest label so the
        //    tab appears in the launcher before the bundle loads
        //  - neither: fall back to the install-time label from the manifest
        const panel = getPanel(decl.id)
        const lazyDesc = panel ? null : getLazyPanel(decl.id)
        const label = panel?.label() ?? lazyDesc?.label ?? decl.label
        if (!label) continue
        apps.push({
          // Single-panel plugins keep the plugin id as the app id (preserves
          // saved layouts for translation/reviewdeck); multi-panel plugins
          // namespace per panel to stay unique.
          id: plugin.panels.length === 1 ? plugin.plugin_id : decl.id,
          label,
          Component: getPluginApp(decl.id),
          group: 'extension',
        })
      }
    }

    return apps
  }, [
    t,
    workspaceId,
    ws?.status,
    wsPlugins,
    user?.role,
    panelsVersion,
    lazyVersion,
  ])
}
