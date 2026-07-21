export interface User {
  id: string
  username: string
  role: 'user' | 'admin' | 'system'
  auth_source: 'password' | 'ldap'
  default_prompt_id: string | null
  default_prompt_name: string | null
  auto_evolution: boolean
}

export type { ApiWorkspace as Workspace } from '@neutree-ai/types'

export interface CallableAgent {
  id: string
  slug: string
  name: string
  owner: string
  visibility: string
  is_own: boolean
  status: string
}

export type { ApiTag as Tag } from '@neutree-ai/types'

export type { ApiSession as Session, ApiK8sStatus as K8sResourceStatus } from '@neutree-ai/types'

export type { ApiMessage } from '@neutree-ai/types'

export interface ChatImageAttachment {
  data: string // base64 encoded
  media_type: string // 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

/**
 * A follow-up message the user queued while a session's turn was still
 * running. Persisted on the session; drained server-side into a fresh turn
 * once the current turn ends. Single draft per session — re-arming merges.
 */
export interface PendingMessage {
  content: string
  images: ChatImageAttachment[]
}

export type { ComputeResources, ApiWorkspaceConfig } from '@neutree-ai/types'

export type {
  ApiTemplate,
  ApiTemplateGrant,
  ApiTemplateVersion,
  TemplateGrant,
  TemplatePermission,
  TemplateVisibility,
  TemplateLinkMissingItem,
} from '@neutree-ai/types'

export type { ApiWorkspaceLayout, LayoutSkeleton } from '@neutree-ai/types'

export type {
  ApiModelProvider,
  ApiProviderGrant,
  ProviderGrant,
  ProviderVisibility,
} from '@neutree-ai/types'

export type {
  ApiEnvironment,
  ApiEnvironmentGrant,
  ApiEnvironmentToken,
  CreatedEnvironmentToken,
  EnvironmentGrant,
  EnvironmentVisibility,
} from '@neutree-ai/types'

export type {
  ApiPrompt,
  ApiPromptGrant,
  ApiPromptVersion,
  PromptGrant,
  PromptPermission,
  PromptVisibility,
} from '@neutree-ai/types'

export type {
  ApiSkill,
  ApiSkillExport,
  ApiSkillGrant,
  ApiSkillSource,
  ApiSkillVersion,
  SkillDependents,
  SkillGrant,
  SkillPermission,
  SkillSourceKind,
  SkillVisibility,
} from '@neutree-ai/types'

export type { ApiCredentialMeta } from '@neutree-ai/types'

export type { ApiShare, ApiShareConfig, ApiShareTrigger } from '@neutree-ai/types'
export type {
  ApiSchedule as Schedule,
  ApiWorkspaceCommand as WorkspaceCommand,
} from '@neutree-ai/types'
export type { ApiAgentRequest } from '@neutree-ai/types'

export type { ApiApplication, ApiApplicationSecret } from '@neutree-ai/types'

export type {
  ApiTeam,
  ApiTeamInvite,
  ApiTeamInvitePreview,
  ApiTeamMember,
  TeamRole,
} from '@neutree-ai/types'

export type {
  ApiTeamworkParticipant,
  ApiTeamworkRosterCandidate,
  ApiTeamworkSession,
  ApiTeamworkTask,
  TeamworkSessionRole,
} from '@neutree-ai/types'

export type {
  ApiMemory,
  ApiMemoryLite,
  ApiMemoryStore,
  ApiMemoryStoreAttachment,
  ApiMemoryVersion,
  ApiMemoryVersionDetail,
  ApiWorkspaceMemoryAttachment,
  MemoryAccess,
} from '@neutree-ai/types'

export interface ApiServiceToken {
  id: string
  name: string
  token?: string
  created_by: string | null
  created_at: string
  is_platform: boolean
}

export type { ApiShareData } from '@neutree-ai/types'

export interface AdminTotals {
  total_users: number
  weekly_active_users: number
  total_agents: number
  weekly_active_agents: number
  total_sessions: number
  sessions_today: number
  total_interactions: number
  interactions_today: number
}

export interface AdminTrend {
  date: string
  agents: number
  sessions: number
  active_agents: number
  interactions: number
  daily_interactions: number
}

/** Fleet-wide token usage, all-in = input+output+cache. Total and rankings are
 *  all-time; `daily` is a recent 30-day window for the trend chart. */
export interface AdminTokenUsage {
  /** All-time all-in token total. */
  total: number
  /** Today's all-in tokens. */
  today: number
  /** Daily totals split by kind (last 30 days), for the stacked volume chart. */
  daily: {
    date: string
    input: number
    output: number
    cache_write: number
    cache_read: number
  }[]
  topUsers: { name: string; tokens: number }[]
  topWorkspaces: { name: string; owner: string; tokens: number }[]
}

export interface AdminAgentType {
  agent_type: string
  count: number
}

export interface AdminSessionSource {
  source: string
  count: number
}

export interface AdminPowerUser {
  name: string
  agent_count: number
  interactions: number
}

export interface AdminPowerAgent {
  name: string
  owner: string
  interactions: number
  session_count: number
}

export interface AdminSkillUsage {
  skill_name: string
  workspace_count: number
}

export interface McpCatalogEntry {
  id: string
  label: string
  description: string
  url: string
  saas_url: string | null
  group: string
  ui_panel: string | null
  required: boolean
  params: { header: string; label: string; type: string; default: string }[]
}

export interface AdminMcpUsage {
  server_id: string
  workspace_count: number
}

interface AdminClusterNode {
  name: string
  cpu_capacity: number
  mem_capacity_mi: number
  cpu_requested: number
  mem_requested_mi: number
  cpu_free: number
  mem_free_mi: number
  pod_count: number
  tos_pod_count: number
  sbx_pod_count: number
}

export interface AdminClusterNodeGroup {
  group: string
  nodes: AdminClusterNode[]
  totals: {
    cpu_capacity: number
    mem_capacity_mi: number
    cpu_requested: number
    mem_requested_mi: number
    node_count: number
    pod_count: number
    tos_pod_count: number
    sbx_pod_count: number
  }
}

export interface AdminCluster {
  node_groups: AdminClusterNodeGroup[]
  workspace_tiers: { small: number; medium: number; large: number }
  total_workspaces: number
  total_sandboxes: number
}

interface AdminUser {
  id: string
  username: string
  display_name: string
  email: string | null
  role: 'user' | 'admin'
  auth_source: 'password' | 'ldap'
  created_at: string
  last_login_at: string | null
  /** Number of workspaces (agents) owned by this user. */
  agent_count: number
  /** Lifetime interaction count across the user's workspaces. */
  interactions: number
  /** Lifetime token total across the user's workspaces. */
  tokens: number
  /** Most recent session activity across the user's workspaces. */
  last_active_at: string | null
}

export type AdminUsersSort =
  | 'tokens'
  | 'interactions'
  | 'agents'
  | 'name'
  | 'created'
  | 'last_active'

export interface AdminUsersQuery {
  page?: number
  pageSize?: number
  sort?: AdminUsersSort
  order?: 'asc' | 'desc'
  q?: string
}

export interface AdminUsersPage {
  items: AdminUser[]
  total: number
  page: number
  pageSize: number
}

export interface AdminWorkspace {
  id: string
  name: string
  status: 'running' | 'stopped' | 'error'
  owner_id: string
  owner: string
  owner_username: string
  agent_type: string
  interactions: number
  tokens: number
  last_active_at: string | null
  created_at: string
}

export type AdminWorkspacesSort =
  | 'tokens'
  | 'interactions'
  | 'last_active'
  | 'created'
  | 'name'
  | 'status'

export interface AdminWorkspacesQuery {
  page?: number
  pageSize?: number
  sort?: AdminWorkspacesSort
  order?: 'asc' | 'desc'
  q?: string
  status?: 'running' | 'stopped' | 'error'
  agentType?: string
  ownerId?: string
}

export interface AdminWorkspacesPage {
  items: AdminWorkspace[]
  total: number
  page: number
  pageSize: number
}

export interface BrowserSession {
  id: string
  status: string
  expires_at: string
  created_at: string
  live_view_url?: string | null
  endpoints?: {
    cdp: string | null
    live_view: string | null
  }
}

export interface BrowserListResponse {
  items: BrowserSession[]
}

export interface SandboxInfo {
  id: string
  image?: { uri: string }
  status: { state: string; reason: string; message: string; lastTransitionAt: string }
  expiresAt: string
  createdAt: string
  metadata?: Record<string, string>
}

export interface SandboxListResponse {
  items: SandboxInfo[]
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number }
}

// ── AgentInfo (from GET /info) ──

export interface AgentCapabilities {
  system_prompt: boolean
  mcp: boolean
  skills: boolean
  questions: boolean
  reconnect: boolean
  permissions: boolean
  streaming_deltas: boolean
}

export interface AgentInfo {
  agent_type: string
  model: string
  capabilities: AgentCapabilities
}

// ── TurnStats ──

import type { ContextGauge, TurnStats } from '@neutree-ai/types'
export type { ContextGauge, TurnStats }

// ── Workspace profile ──

export type { WorkspaceProfilePayload } from '@neutree-ai/types'

// ── User profile ──

export type { UserProfilePayload } from '@neutree-ai/types'

export type { ApiRecentSessionItem, ApiActivitySummary, ApiUsageSummary } from '@neutree-ai/types'

// ── AskUserQuestion types ──

interface AskUserQuestionOption {
  label: string
  description: string
}

export interface AskUserQuestionItem {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export interface AskUserRequest {
  requestId: string
  questions: AskUserQuestionItem[]
}
