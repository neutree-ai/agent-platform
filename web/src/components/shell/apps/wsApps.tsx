import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Spinner } from '@/components/ui/spinner'
import { WorkspaceChatPanel } from '@/components/workspace/WorkspaceChatPanel'
import { useFileAnchor } from '@/components/workspace/file-preview/useFileAnchor'
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace'
import type { DriveKind } from '@/lib/api/agent-files'
import type { AppComponentProps } from '@/lib/app-registry'
import { getPanel, getPanelsVersion, subscribePanels } from '@/lib/panel-registry'
import {
  getLazyPanel,
  getLazyRegistryVersion,
  subscribeLazyRegistry,
} from '@/lib/plugin-lazy-registry'
import { ensurePluginLoaded } from '@/lib/plugin-loader'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { type ComponentType, Suspense, lazy, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

const WorkspaceFilesPanel = lazy(() =>
  import('@/components/workspace/WorkspaceFilesPanel').then((m) => ({
    default: m.WorkspaceFilesPanel,
  })),
)
const WorkspaceTerminalPanel = lazy(() =>
  import('@/components/workspace/WorkspaceTerminalPanel').then((m) => ({
    default: m.WorkspaceTerminalPanel,
  })),
)
const WorkspaceSandboxPanel = lazy(() =>
  import('@/components/workspace/WorkspaceSandboxPanel').then((m) => ({
    default: m.WorkspaceSandboxPanel,
  })),
)
const WorkspaceBrowserPanel = lazy(() =>
  import('@/components/workspace/WorkspaceBrowserPanel').then((m) => ({
    default: m.WorkspaceBrowserPanel,
  })),
)
const WorkspaceSkillsPanel = lazy(() =>
  import('@/components/workspace/WorkspaceSkillsPanel').then((m) => ({
    default: m.WorkspaceSkillsPanel,
  })),
)
const WorkspaceSessionsPanel = lazy(() =>
  import('@/components/workspace/WorkspaceSessionsPanel').then((m) => ({
    default: m.WorkspaceSessionsPanel,
  })),
)
const WorkspaceAutomationPanel = lazy(() =>
  import('@/components/workspace/WorkspaceAutomationPanel').then((m) => ({
    default: m.WorkspaceAutomationPanel,
  })),
)
const WorkspaceSettingsPanel = lazy(() =>
  import('@/components/workspace/WorkspaceSettingsPanel').then((m) => ({
    default: m.WorkspaceSettingsPanel,
  })),
)
const FileViewer = lazy(() =>
  import('@/components/workspace/FileViewer').then((m) => ({ default: m.FileViewer })),
)
const LibraryPanel = lazy(() =>
  import('@/components/library/LibraryPanel').then((m) => ({ default: m.LibraryPanel })),
)
const ConnectorsSection = lazy(() =>
  import('@/components/integration/ConnectorsSection').then((m) => ({
    default: m.ConnectorsSection,
  })),
)
const ServiceTokensSection = lazy(() =>
  import('@/components/management/ServiceTokensSection').then((m) => ({
    default: m.ServiceTokensSection,
  })),
)
const ApplicationsSection = lazy(() =>
  import('@/components/management/ApplicationsSection').then((m) => ({
    default: m.ApplicationsSection,
  })),
)
const EnvironmentsSection = lazy(() =>
  import('@/components/management/EnvironmentsSection').then((m) => ({
    default: m.EnvironmentsSection,
  })),
)
const ProvidersSection = lazy(() =>
  import('@/components/management/ProvidersSection').then((m) => ({
    default: m.ProvidersSection,
  })),
)
const CredentialsSection = lazy(() =>
  import('@/components/management/CredentialsSection').then((m) => ({
    default: m.CredentialsSection,
  })),
)
const TagsSection = lazy(() =>
  import('@/components/management/TagsSection').then((m) => ({
    default: m.TagsSection,
  })),
)
const TeamsSection = lazy(() =>
  import('@/components/management/TeamsSection').then((m) => ({
    default: m.TeamsSection,
  })),
)
const TeamworkSection = lazy(() =>
  import('@/components/teamwork/TeamworkSection').then((m) => ({
    default: m.TeamworkSection,
  })),
)
const AdminPanel = lazy(() =>
  import('@/components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
)
const MemoryStoresPanel = lazy(() =>
  import('@/components/memory/MemoryStoresPanel').then((m) => ({
    default: m.MemoryStoresPanel,
  })),
)

function AppFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      <Spinner size="sm" className="mr-1.5" /> {t('common.loading')}
    </div>
  )
}

function NotRunning() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyHero
        illustration={<EmptyIllustration src="not-running" size="h-32" />}
        title={t('pages.workspace.empty.notRunning.title')}
        description={t('pages.workspace.empty.notRunning.description')}
      />
    </div>
  )
}

export function FilesApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  if (ws.status !== 'running') return <NotRunning />
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceFilesPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function BrowserApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceBrowserPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function SkillsApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  if (ws.status !== 'running') return <NotRunning />
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceSkillsPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function TerminalApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  if (ws.status !== 'running') return <NotRunning />
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceTerminalPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function SandboxApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceSandboxPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function ChatApp() {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return <WorkspaceChatPanel workspace={ws} />
}

export function SessionsApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceSessionsPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function AutomationApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceAutomationPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

export function MemoryApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  // Workspace-scoped view of the global MemoryStores app: the same panel
  // narrowed to stores attached to this workspace, with a one-click attach
  // for existing stores and auto-attach for newly created ones.
  return (
    <Suspense fallback={<AppFallback />}>
      <MemoryStoresPanel instanceId={instanceId} workspaceId={ws.id} />
    </Suspense>
  )
}

export function SettingsApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceSettingsPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Library — global resource browser (prompts / skills / templates). Data is
 * user-scoped, but per-instance UI state (selected item, sub-nav section)
 * lives in workspace_profile.instances[id], so two ws can each have their
 * own Library view position.
 */
export function LibraryApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <LibraryPanel instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Connectors — inbound integration entry points (webhooks etc).
 */
export function ConnectorsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <ConnectorsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * ServiceTokens — platform-issued tokens the agent uses to authenticate
 * to NAP APIs from outside.
 */
export function ServiceTokensApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <ServiceTokensSection instanceId={instanceId} />
    </Suspense>
  )
}

export function EnvironmentsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <EnvironmentsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * OAuthApps — third-party OAuth applications registered against the user's
 * account.
 */
export function OAuthAppsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <ApplicationsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Models — global AI model provider configuration (OpenAI, Anthropic, etc.)
 */
export function ModelsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <ProvidersSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Credentials — global secret store (SSH keys, API keys for various services).
 */
export function CredentialsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <CredentialsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * MemoryStores — global app for managing user-level memory stores. Stores
 * are CMA-style path-keyed markdown files that workspaces can attach to;
 * agent integration lands in P4. Until then this is human-only.
 */
export function MemoryStoresApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <MemoryStoresPanel instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Tags — global app for managing the workspace tag taxonomy. User-private,
 * shared across all workspaces; the WorkspacesApp filter row and ws settings
 * read from the same list.
 */
export function TagsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <TagsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Teams — user-scoped teams the current user belongs to. Members are managed
 * here; resource sharing surfaces (prompts, providers) consume team
 * membership separately.
 */
export function TeamsApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <TeamsSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Teamwork (preview) — global app for orchestrating a coordinator agent and
 * a roster of agents around a shared task. The coordinator chats with the
 * user and dispatches via call_agent; roster members collaborate through a
 * shared AFS folder.
 */
export function TeamworkApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <TeamworkSection instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Admin — global admin console (dashboard / users / infra / system).
 * Visibility/access control is handled inside the sections themselves.
 */
export function AdminApp({ instanceId }: AppComponentProps) {
  return (
    <Suspense fallback={<AppFallback />}>
      <AdminPanel instanceId={instanceId} />
    </Suspense>
  )
}

/**
 * Hidden single-file viewer. Created only via `openInPopout('file', ...)`;
 * does not appear in the dock or SlotPicker. Reads `viewingPath` and
 * `drive` from the instance's persistent state, which the caller seeds.
 */
export function FileApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  if (ws.status !== 'running') return <NotRunning />
  return (
    <Suspense fallback={<AppFallback />}>
      <FileAppBody workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}

function FileAppBody({ workspaceId, instanceId }: { workspaceId: string; instanceId: string }) {
  const [viewingPath] = useInstancePersistentState<string>(instanceId, 'viewingPath', () => '')
  const [drive] = useInstancePersistentState<DriveKind>(instanceId, 'drive', () => 'workspace')
  const { viewingLine, viewingColumn } = useFileAnchor(instanceId)
  if (!viewingPath) return null
  return (
    <FileViewer
      filePath={viewingPath}
      workspaceId={workspaceId}
      instanceId={instanceId}
      drive={drive}
      viewingLine={viewingLine}
      viewingColumn={viewingColumn}
    />
  )
}

// Module-level cache keeps Component identity stable per pluginId — needed
// so React doesn't unmount when the apps array regenerates.
const pluginAppCache = new Map<string, ComponentType<AppComponentProps>>()

export function getPluginApp(pluginId: string): ComponentType<AppComponentProps> {
  let cached = pluginAppCache.get(pluginId)
  if (cached) return cached
  function PluginApp({ instanceId }: AppComponentProps) {
    const ws = useCurrentWorkspace()
    // Subscribe to both registries so we re-render when the lazy bundle
    // arrives (panel-registry version bumps via `registerPanel`) or when
    // the manifest fetch resolves and a descriptor lands.
    useSyncExternalStore(subscribePanels, getPanelsVersion)
    useSyncExternalStore(subscribeLazyRegistry, getLazyRegistryVersion)
    const panel = getPanel(pluginId)
    const lazyDesc = panel ? null : getLazyPanel(pluginId)
    // When opening a tab whose plugin hasn't loaded yet, kick the load
    // here. `ensurePluginLoaded` is memoized so re-mounts share one
    // inject. Plain `useEffect` so unmount-before-load doesn't crash —
    // the load still completes and registers, just no one's watching.
    useEffect(() => {
      if (lazyDesc) ensurePluginLoaded(lazyDesc.pluginId).catch(() => {})
    }, [lazyDesc])
    if (!ws) return null
    if (!panel) {
      // Lazy bundle in flight (or unknown plugin id) — show a spinner;
      // the subscription above re-renders once `registerPanel` lands.
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner size="sm" />
        </div>
      )
    }
    const Comp = panel.component
    return <Comp workspaceId={ws.id} instanceId={instanceId} />
  }
  PluginApp.displayName = `PluginApp(${pluginId})`
  cached = PluginApp
  pluginAppCache.set(pluginId, cached)
  return cached
}
