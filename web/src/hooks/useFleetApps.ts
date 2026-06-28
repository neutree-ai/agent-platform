import { ActivityApp } from '@/components/home/ActivityApp'
import { WorkspacesApp } from '@/components/home/WorkspacesApp'
import {
  AdminApp,
  ConnectorsApp,
  CredentialsApp,
  EnvironmentsApp,
  LibraryApp,
  MemoryStoresApp,
  ModelsApp,
  OAuthAppsApp,
  ServiceTokensApp,
  TagsApp,
  TeamsApp,
  TeamworkApp,
} from '@/components/shell/apps/wsApps'
import { useAuth } from '@/contexts/AuthContext'
import type { AppDefinition } from '@/lib/app-registry'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Fleet-scope app registry. Built-ins here are user-scoped (no workspace
 * dependency): the workspaces grid, the global resource libraries, and
 * platform-level config. Apps that need a running workspace (chat, files,
 * terminal, sandbox, ...) only appear in ws scope (`useWsApps`).
 */
export function useFleetApps(): AppDefinition[] {
  const { t } = useTranslation()
  const { user } = useAuth()

  return useMemo(() => {
    const apps: AppDefinition[] = []

    // Fleet landing trio — three focused apps that compose a dashboard via
    // the default 3-col layout. Users can close/move any one.
    apps.push({
      id: 'workspaces',
      label: t('components.shell.workspacesApp.appLabel'),
      Component: WorkspacesApp,
      group: 'agent',
    })
    apps.push({
      id: 'tags',
      label: t('pages.workspace.tabs.tags'),
      Component: TagsApp,
      group: 'agent',
    })
    apps.push({
      id: 'activity',
      label: t('components.shell.activityApp.appLabel'),
      Component: ActivityApp,
      group: 'agent',
    })

    // Capability — global resource browsers
    apps.push({
      id: 'library',
      label: t('pages.workspace.tabs.library'),
      Component: LibraryApp,
      group: 'capability',
    })
    apps.push({
      id: 'memory-stores',
      label: t('pages.workspace.tabs.memoryStores'),
      Component: MemoryStoresApp,
      group: 'capability',
    })
    apps.push({
      id: 'teamwork',
      label: t('pages.workspace.tabs.teamwork'),
      Component: TeamworkApp,
      group: 'agent',
      badge: 'preview',
    })

    // Connection — agent-facing integrations
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
    apps.push({
      id: 'environments',
      label: t('pages.workspace.tabs.environments'),
      Component: EnvironmentsApp,
      group: 'connection',
    })

    // System — platform config
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

    return apps
  }, [t, user?.role])
}
