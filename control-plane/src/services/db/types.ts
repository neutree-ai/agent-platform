import type { ComputeResources, LayoutSkeleton } from '../../../../internal/types/api'

export interface User {
  id: string
  username: string
  display_name: string
  email: string | null
  password_hash: string | null
  role: 'user' | 'admin' | 'system'
  default_prompt_id: string | null
  auto_evolution: boolean
  created_at: string
  last_login_at: string | null
}

export interface Workspace {
  id: string
  user_id: string
  name: string
  slug: string | null
  visibility: string
  is_system: boolean
  status: string
  created_at: string
  // Deployed runtime template version (cached from the Deployment's
  // workspace-version annotation). null = unknown/legacy. Compared against
  // CURRENT_TEMPLATE_VERSION to decide whether a rebuild/update is available.
  runtime_version: number | null
}

/**
 * Persisted per-session "context gauge" — how full the context window is and
 * how many turns deep, for the chat stats bar. Token accounting is NOT here; it
 * lives in the append-only workspace_usage_events ledger.
 */
export interface SessionTurnStats {
  numTurns: number
  contextTokens: number
  contextWindow: number
}

/**
 * A follow-up message a user queued while the session's turn was still
 * running. Drained into a fresh turn once the current turn ends cleanly.
 * Single draft per session (re-arming merges), not a queue.
 */
export interface SessionPendingMessage {
  content: string
  images: { data: string; media_type: string }[]
}

export interface Session {
  id: string
  workspace_id: string
  name: string
  status: string
  chat_status: string
  /** How the session was created: 'web' | 'agent' | 'schedule' | 'slack' | 'wecom' | 'webhook'. */
  source: string
  created_at: string
  last_active_at: string
  last_turn_stats: SessionTurnStats | null
  caller_user_id: string | null
  /** Calling agent's workspace id when `source = 'agent'`; null otherwise. */
  caller_workspace_id: string | null
  /**
   * The replica id this session is pinned to on an auto-scaling workspace, so
   * every turn hits the same agent process (shared-volume transcript safety).
   * NULL for static single-replica sessions; the routing seam resolves NULL to
   * the workspace's default address. Set by the replica router on the session's
   * first turn.
   */
  replica_ordinal: number | null
  pending_message: SessionPendingMessage | null
  /** When the session was starred, or null when it is not starred. */
  starred_at: string | null
}

export interface Message {
  id: string
  workspace_id: string
  session_id: string | null
  role: string
  content: string
  created_at: string
}

export interface MessageWithBlocks extends Message {
  blocks: unknown[]
  /** Turn start = message.created_at. */
  started_at: string
  /** Turn end = latest session_event for this message; null when no events. */
  ended_at: string | null
  /** ended_at - started_at in milliseconds; null when ended_at is null. */
  duration_ms: number | null
}

export interface UserCredential {
  user_id: string
  name: string
  value: string
  inject: string
  path: string | null
  mode: string | null
  scope: string
  status: string
  updated_at: string
  /** Populated by list queries; absent in single-row lookups. */
  workspace_ids?: string[]
}

export interface WorkspaceConfig {
  workspace_id: string
  provider_id: string | null
  prompt_id: string | null
  prompt_name: string | null
  prompt_content: string | null
  template_id: string | null
  template_version: number | null
  template_name: string | null
  template_latest_version: number | null
  agent_type: string
  provider_type: string
  model: string
  base_url: string
  api_key: string
  small_model: string
  system_prompt: string
  mcp_config: string
  agent_settings: string
  compute_resources: ComputeResources
  /** When false, a stopped workspace is not auto-started on incoming chat. */
  auto_start: boolean
  /**
   * Auto-scaling parameters, or null for a static (single fixed replica)
   * workspace. Its PRESENCE is the runtime-shape discriminant — there is no
   * separate mode flag, and a static workspace has no replica parameters to
   * mis-read. Fixed at creation, immutable after. Per-replica turn capacity
   * reuses max_concurrency, so it is not part of this object.
   */
  auto_scaling: AutoScalingConfig | null
  updated_at: string
}

/** Replica sizing for an auto-scaling workspace (workspace_config.auto_scaling). */
interface AutoScalingConfig {
  /** Lower bound; may be 0 to allow scale-to-zero. */
  min_replicas: number
  /** Upper bound; >= 1 and >= min_replicas. */
  max_replicas: number
  /** Idle seconds before scaling to zero; null = never. */
  scale_to_zero_idle_seconds: number | null
}

type EnvironmentVisibility = 'private' | 'team' | 'public'

export interface Environment {
  id: string
  user_id: string
  name: string
  visibility: EnvironmentVisibility
  kind: string
  status: string
  capabilities: Record<string, unknown>
  placement: Record<string, unknown>
  last_heartbeat_at: string | null
  is_builtin: boolean
  created_at: string
}

export interface EnvironmentToken {
  id: string
  environment_id: string
  name: string
  token_hash: string
  created_by: string
  created_at: string
  revoked_at: string | null
}

export type PromptVisibility = 'private' | 'team' | 'public'

export interface Prompt {
  id: string
  user_id: string
  name: string
  content: string
  visibility: PromptVisibility
  /** @deprecated phase-2 drop. cp double-writes for rolling-deploy compatibility */
  is_public: boolean
  current_version: number
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  id: string
  prompt_id: string
  version: number
  content: string
  created_at: string
}

interface ActiveSessionSummary {
  id: string
  chat_status: string
  name?: string
  preview: string
}

export interface WorkspaceWithSessionCounts extends Workspace {
  active_agent_sessions: number
  active_human_sessions: number
  active_sessions: ActiveSessionSummary[]
}

export interface SessionWithPreview extends Session {
  message_count: number
  preview: string
  /** Calling agent's display name, joined from its workspace; null when not agent-invoked. */
  caller_agent_name: string | null
  /** Calling agent's slug, joined from its workspace; null when not agent-invoked. */
  caller_agent_slug: string | null
}

export interface PaginatedSessions {
  items: SessionWithPreview[]
  total: number
}

export type SkillVisibility = 'private' | 'team' | 'public'
export type SkillSourceKind = 'git' | 'native'

/**
 * Metadata view of a row in `skills`. Identifier is `id` (UUID); `name` is
 * unique per owner (`UNIQUE(user_id, name)`) — global lookups by name no
 * longer work, callers must scope by owner.
 *
 * Binary content lives in `skill_versions.package`; `active_version_id`
 * points to the current published version. `source_id` is mandatory —
 * every skill belongs to a git or native source (see SkillSource).
 */
export interface SkillMeta {
  id: string
  source_id: string
  source_kind: SkillSourceKind
  /**
   * Pointer to the current published version. NULL is a legal transient
   * state during skill creation — cp creates the skill row first, then asks
   * scs to write the first version row in a separate transaction, then cp
   * updates this pointer. After steady state, "skill with no active version"
   * shouldn't happen in normal use; the UI should treat NULL defensively.
   */
  active_version_id: string | null
  name: string
  subpath: string
  description: string
  user_id: string
  is_public: boolean
  visibility: SkillVisibility
  owner_name: string
  category: string | null
  created_at: string
  updated_at: string
}

/**
 * A skill's iteration unit. `git` sources back monorepo imports (one source,
 * many skills — different subpaths); `native` sources back in-NAP authoring
 * (one source, one skill, with `draft_package` holding the work-in-progress).
 */
export interface SkillSource {
  id: string
  user_id: string
  kind: SkillSourceKind
  // git kind
  git_type: string | null
  git_url: string | null
  git_host: string | null
  git_owner: string | null
  git_repo: string | null
  git_ref: string | null
  credential_name: string | null
  last_commit_sha: string | null
  last_synced_at: string | null
  // native kind — draft_package is BYTEA; we only surface its presence here,
  // the bytes themselves are fetched via a dedicated endpoint.
  has_draft: boolean
  // unfiltered count of skills attached to this source. Lets the UI tell a
  // truly orphaned source ("0 skills, offer Delete") apart from one whose
  // skills the current filter just happens to hide ("hide the group").
  skill_count: number
  created_at: string
  updated_at: string
}

/**
 * A point-in-time snapshot of a skill's package. Created by import / sync /
 * publish events. `content_hash` is generated; `(skill_id, content_hash)`
 * is UNIQUE so re-importing the same content is idempotent.
 */
export interface SkillVersion {
  id: string
  skill_id: string
  source_id: string
  content_hash: string
  commit_sha: string | null
  note: string | null
  published_at: string
  published_by: string
}

export interface WorkspaceTag {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

export interface Share {
  id: string
  user_id: string
  workspace_id: string
  session_id: string
  title: string
  data: unknown
  created_at: string
}

/** List projection of Share — omits the heavy `data` column. */
export type ShareSummary = Omit<Share, 'data'>

export interface ServiceToken {
  id: string
  name: string
  token_hash: string
  created_by: string | null
  created_at: string
  revoked_at: string | null
  is_platform: boolean
}

export type ProviderVisibility = 'private' | 'team' | 'public'

export interface ModelProvider {
  id: string
  name: string
  description: string
  provider_type: string
  base_url: string
  api_key: string
  user_id: string
  is_public: boolean
  visibility: ProviderVisibility
  created_at: string
  updated_at: string
}

export type TemplateVisibility = 'private' | 'team' | 'public'

export interface Template {
  id: string
  name: string
  description: string
  owner_id: string
  owner_name: string
  visibility: TemplateVisibility
  latest_version: number
  created_at: string
  updated_at: string
}

interface TemplateVersionCommand {
  id: string
  name: string
  type: 'plain' | 'struct'
  prompt_id: string | null
  content: string
  sort_order: number
}

export interface TemplateVersionSchedule {
  id: string
  name: string
  cron: string
  timezone: string
  prompt: string
  prompt_id: string | null
  /** Builder's ship default; recipient may override at create/sync and toggle after. */
  enabled_default: boolean
  sort_order: number
}

export interface TemplateVersion {
  id: string
  template_id: string
  version: number
  agent_type: string
  system_prompt: string
  prompt_id: string | null
  prompt_version: number | null
  mcp_config: string
  agent_settings: string
  compute_resources: Record<string, any>
  provider_id: string | null
  provider_name: string | null
  model: string
  small_model: string
  skill_names: string[]
  /** Command set this version distributes (read-time base for workspaces). */
  commands: TemplateVersionCommand[]
  /** Schedule set this version distributes (materialized into workspaces). */
  schedules: TemplateVersionSchedule[]
  /** workspace_layout row this version ships (link; copied at create/sync). */
  layout_id: string | null
  created_at: string
}

export interface WorkspaceLayout {
  id: string
  owner_id: string
  name: string
  description: string
  /** { layout_id, slots: { slotId: appId[] } } */
  skeleton: LayoutSkeleton
  /** 'local' = user's own (custom); 'template' = copy from a template (preset-class). */
  origin: 'local' | 'template'
  source_template_id: string | null
  created_at: string
  updated_at: string
}

export interface Schedule {
  id: string
  workspace_id: string
  user_id: string
  name: string
  cron: string | null
  run_at: string | null
  timezone: string
  prompt: string
  prompt_id: string | null
  prompt_content: string | null
  enabled: boolean
  /** 'local' = user's own schedule; 'template' = materialized from the template (read-only except enable/disable). */
  origin: 'local' | 'template'
  last_run_at: string | null
  completed_at: string | null
  pgboss_job_id: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceCommand {
  id: string
  workspace_id: string
  user_id: string
  name: string
  type: 'plain' | 'struct'
  prompt_id: string | null
  prompt_content: string | null
  content: string
  sort_order: number
  /**
   * Row provenance. 'local' = the user's own command (incl. forked copies).
   * 'template' = a marker row for a template-provided command; carries no
   * content of its own (resolved from template_version_commands at read time),
   * its only meaningful state is `disabled`.
   */
  origin: 'local' | 'template'
  disabled: boolean
  created_at: string
  updated_at: string
}

export interface BatchRun {
  id: string
  name: string
  user_id: string
  status: string
  concurrency: number
  stats: unknown
  created_at: string
  completed_at: string | null
}

export interface BatchTask {
  id: string
  batch_run_id: string
  workspace_id: string
  prompt: string
  status: string
  session_id: string | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface AgentRequest {
  id: string
  workspace_id: string
  user_id: string
  kind: string
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'applied'
  reject_reason: string | null
  created_at: string
  resolved_at: string | null
  applied_at: string | null
}
