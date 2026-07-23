// Shared API types between frontend and backend

import { z } from 'zod'
import type { ContextGauge, TurnStats } from './events.js'

export interface ApiUser {
  id: string
  username: string
  role: 'user' | 'admin' | 'system'
  auth_source: 'password' | 'ldap'
  default_prompt_id: string | null
  default_prompt_name: string | null
  auto_evolution: boolean
}

export const ApiWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  visibility: z.string(),
  is_system: z.boolean(),
  owner: z.string(),
  status: z.string(),
  created_at: z.string(),
  tag_ids: z.array(z.string()),
  active_agent_sessions: z.number().int(),
  active_human_sessions: z.number().int(),
  active_sessions: z.array(
    z.object({
      id: z.string(),
      chat_status: z.string(),
      preview: z.string(),
      name: z.string().optional(),
    }),
  ),
  // True when the deployed runtime is behind the current platform template
  // and can be rebuilt to pick it up. Derived from the cached runtime_version,
  // so it's free to read (no k8s call).
  rebuild_available: z.boolean(),
})

export type ApiWorkspace = z.infer<typeof ApiWorkspaceSchema>

export const WorkspaceVisibilitySchema = z.enum(['private', 'user', 'public'])

export const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'slug must be lowercase alphanumeric with optional hyphens',
  )

/**
 * Body for `POST /api/workspaces`. Two modes:
 *  - Template mode: pass `template_id`; agent_type / config fields / skill_names are taken from the template's latest version (others ignored).
 *  - Blank mode: pass agent_type and any config fields directly.
 */
export const WorkspaceCreateBodySchema = z.object({
  name: z.string().min(1),
  template_id: z.string().optional(),
  is_system: z.boolean().optional(),
  // Target environment for placement (BYOI). Omitted → built-in. Must be an
  // environment the user can see; capability/liveness are checked server-side.
  environment_id: z.string().optional(),
  agent_type: z.string().optional(),
  compute_resources: z.record(z.string(), z.string()).optional(),
  provider_id: z.string().optional(),
  provider_type: z.string().optional(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
  prompt_id: z.string().optional(),
  system_prompt: z.string().optional(),
  mcp_config: z.string().optional(),
  agent_settings: z.string().optional(),
  // p3: workspace skills are keyed by UUID. `skill_ids` is the authoritative
  // input; `skill_names` is retained for backward compatibility with clients
  // that still pass names. Routes prefer ids when both are present.
  skill_ids: z.array(z.string()).optional(),
  skill_names: z.array(z.string()).optional(),
  // Recipient consent for template-provided schedules: name → enabled. Absent
  // entries fall back to the template's enabled_default. Both UI and API set this.
  schedule_overrides: z.record(z.string(), z.boolean()).optional(),
})

export type WorkspaceCreateBody = z.infer<typeof WorkspaceCreateBodySchema>

export const WorkspacePatchBodySchema = z.object({
  name: z.string().optional(),
  slug: SlugSchema.nullable().optional(),
  visibility: WorkspaceVisibilitySchema.optional(),
})

export type WorkspacePatchBody = z.infer<typeof WorkspacePatchBodySchema>

export const TAG_COLORS = [
  'slate',
  'rose',
  'amber',
  'emerald',
  'sky',
  'violet',
  'orange',
  'pink',
] as const

export const ApiTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  created_at: z.string(),
})

export type ApiTag = z.infer<typeof ApiTagSchema>

export const TagCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  color: z.enum(TAG_COLORS).optional(),
})

export const TagUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1),
    color: z.enum(TAG_COLORS),
  })
  .partial()

export const WorkspaceTagsBodySchema = z.object({
  tag_ids: z.array(z.string()),
})

export const ApiContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
    parent_tool_use_id: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    call_id: z.string(),
    output: z.string(),
    is_error: z.boolean().optional(),
    parent_tool_use_id: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('image'), data: z.string(), media_type: z.string() }),
])

export type ApiContentPart = z.infer<typeof ApiContentPartSchema>

export const ApiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  blocks: z.array(ApiContentPartSchema),
  created_at: z.string(),
  /** Turn start (alias of created_at). */
  started_at: z.string(),
  /** Turn end: latest persisted event for this message; null when no events. */
  ended_at: z.string().nullable(),
  /** ended_at - started_at in milliseconds; null when ended_at is null. */
  duration_ms: z.number().nullable(),
})

export type ApiMessage = z.infer<typeof ApiMessageSchema>

/** The live wire shape carried in the synchronous chat response (full stats). */
export const TurnStatsSchema: z.ZodType<TurnStats> = z.object({
  costUsd: z.number(),
  durationMs: z.number(),
  numTurns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  contextTokens: z.number(),
  contextWindow: z.number(),
})

/**
 * The gauge subset persisted on a session and shown by the chat stats bar.
 * Token accounting is NOT here — it lives in the workspace usage ledger.
 */
export const ContextGaugeSchema: z.ZodType<ContextGauge> = z.object({
  numTurns: z.number(),
  contextTokens: z.number(),
  contextWindow: z.number(),
})

export const ApiSessionSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  status: z.string(),
  chat_status: z.string(),
  /** How the session was created: 'web' | 'agent' | 'schedule' | 'slack' | 'wecom' | 'webhook'. New connector types may add values, so kept as a free string. */
  source: z.string(),
  created_at: z.string(),
  last_active_at: z.string(),
  message_count: z.number().int(),
  preview: z.string(),
  last_turn_stats: ContextGaugeSchema.nullable(),
  /** When the session was starred, or null when it is not starred. */
  starred_at: z.string().nullable(),
  /**
   * The agent that invoked this session via agent-to-agent (`call_agent`).
   * Null for user/web/channel-initiated sessions. Lets the session view show
   * which agent the session originated from.
   */
  caller_agent: z
    .object({
      name: z.string(),
      slug: z.string().nullable(),
    })
    .nullable(),
})

export type ApiSession = z.infer<typeof ApiSessionSchema>

export const ApiSessionListSchema = z.object({
  items: z.array(ApiSessionSchema),
  total: z.number().int(),
})

export type ApiSessionList = z.infer<typeof ApiSessionListSchema>

/**
 * Lightweight session shape returned by the single-session GET. Strict subset
 * of ApiSession plus a `preview` snippet derived from the first user message.
 * Used by the sidebar — does not include workspace_id, created_at, message_count, etc.
 */
/**
 * A follow-up message a user queued while a session's turn was still running.
 * Drained server-side into a fresh turn once the current turn ends cleanly.
 */
export const ApiPendingMessageSchema = z.object({
  content: z.string(),
  images: z.array(z.object({ data: z.string(), media_type: z.string() })),
})

export type ApiPendingMessage = z.infer<typeof ApiPendingMessageSchema>

export const ApiSessionLiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  chat_status: z.string(),
  status: z.string(),
  /** Last time the session produced or received any message. Advances on every
   * persisted turn event, so consumers can detect liveness mid-turn rather than
   * only at turn boundaries. */
  last_active_at: z.string(),
  preview: z.string(),
  /** Queued follow-up draft, or null when there is none. */
  pending_message: ApiPendingMessageSchema.nullable(),
})

export type ApiSessionLite = z.infer<typeof ApiSessionLiteSchema>

export const ApiK8sStatusSchema = z.object({
  deployment: z
    .object({
      ready: z.boolean(),
      replicas: z.number().int(),
      readyReplicas: z.number().int(),
    })
    .nullable(),
  service: z
    .object({
      ready: z.boolean(),
    })
    .nullable(),
  pods: z
    .object({
      total: z.number().int(),
      ready: z.number().int(),
    })
    .nullable(),
  warnings: z.array(z.object({ reason: z.string(), message: z.string() })),
  conditions: z.array(
    z.object({ type: z.string(), status: z.boolean(), message: z.string().optional() }),
  ),
})

export type ApiK8sStatus = z.infer<typeof ApiK8sStatusSchema>

export const ComputeResourcesSchema = z.object({
  cpu_request: z.string().optional(),
  cpu_limit: z.string().optional(),
  memory_request: z.string().optional(),
  memory_limit: z.string().optional(),
  storage: z.string().optional(),
})

export type ComputeResources = z.infer<typeof ComputeResourcesSchema>

export const ApiConfigMemoryAttachmentSchema = z.object({
  store_id: z.string(),
  store_name: z.string(),
  store_description: z.string(),
  access: z.enum(['read_only', 'read_write']),
  instructions: z.string(),
  /** Snapshot of `/MEMORY.md` content at config-render time, null if the store has none yet. */
  index_content: z.string().nullable(),
})

export type ApiConfigMemoryAttachment = z.infer<typeof ApiConfigMemoryAttachmentSchema>

export const ApiWorkspaceConfigSchema = z.object({
  agent_type: z.string(),
  provider_id: z.string().nullable(),
  prompt_id: z.string().nullable(),
  prompt_name: z.string().nullable(),
  prompt_content: z.string().nullable(),
  template_id: z.string().nullable(),
  template_version: z.number().int().nullable(),
  template_name: z.string().nullable(),
  template_latest_version: z.number().int().nullable(),
  provider_type: z.string(),
  model: z.string(),
  base_url: z.string(),
  /** Always returned as empty string; the real value is write-only. */
  api_key: z.string(),
  small_model: z.string(),
  system_prompt: z.string(),
  mcp_config: z.string(),
  agent_settings: z.string(),
  compute_resources: ComputeResourcesSchema,
  /** When false, a stopped workspace is not auto-started on incoming chat. */
  auto_start: z.boolean(),
  user_display_name: z.string().nullable(),
  memory_attachments: z.array(ApiConfigMemoryAttachmentSchema).default([]),
})

export type ApiWorkspaceConfig = z.infer<typeof ApiWorkspaceConfigSchema>

export const PromptVisibilitySchema = z.enum(['private', 'team', 'public'])
export type PromptVisibility = z.infer<typeof PromptVisibilitySchema>

export const PromptPermissionSchema = z.enum(['viewer', 'editor'])
export type PromptPermission = z.infer<typeof PromptPermissionSchema>

export const PromptMyPermissionSchema = z.enum(['owner', 'editor', 'viewer', 'public'])
export type PromptMyPermission = z.infer<typeof PromptMyPermissionSchema>

export const PromptSharedTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  permission: PromptPermissionSchema,
})
export type PromptSharedTeam = z.infer<typeof PromptSharedTeamSchema>

export const ApiPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  visibility: PromptVisibilitySchema,
  /** @deprecated phase-2 drop */
  is_public: z.boolean(),
  current_version: z.number().int(),
  owner_name: z.string(),
  is_own: z.boolean(),
  my_permission: PromptMyPermissionSchema,
  shared_via_teams: z.array(PromptSharedTeamSchema),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiPrompt = z.infer<typeof ApiPromptSchema>

export const PromptGrantSchema = z.object({
  team_id: z.string(),
  permission: PromptPermissionSchema,
})
export type PromptGrant = z.infer<typeof PromptGrantSchema>

export const PromptGrantsBodySchema = z.object({
  grants: z.array(PromptGrantSchema),
})

export const ApiPromptGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: PromptPermissionSchema,
  granted_at: z.string(),
})
export type ApiPromptGrant = z.infer<typeof ApiPromptGrantSchema>

export const ApiPromptVersionSchema = z.object({
  version: z.number().int(),
  content: z.string(),
  created_at: z.string(),
})

export type ApiPromptVersion = z.infer<typeof ApiPromptVersionSchema>

export const PromptCreateBodySchema = z.object({
  name: z.string().min(1),
  content: z.string().optional(),
  visibility: PromptVisibilitySchema.optional(),
  grants: z.array(PromptGrantSchema).optional(),
})

export const PromptUpdateBodySchema = z
  .object({
    name: z.string().min(1),
    content: z.string(),
    visibility: PromptVisibilitySchema,
    grants: z.array(PromptGrantSchema),
  })
  .partial()

export const PromptRollbackBodySchema = z.object({
  version: z.number().int().positive(),
})

// Skill visibility / grants — same shape as prompt/template (viewer + editor
// both meaningful: editor = can re-import/replace package + rename + edit
// description).
export const SkillVisibilitySchema = z.enum(['private', 'team', 'public'])
export type SkillVisibility = z.infer<typeof SkillVisibilitySchema>

export const SkillPermissionSchema = z.enum(['viewer', 'editor'])
export type SkillPermission = z.infer<typeof SkillPermissionSchema>

const SkillMyPermissionSchema = z.enum(['owner', 'editor', 'viewer', 'public'])

const SkillExportTokendTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  permission: SkillPermissionSchema,
})

// ── p3: skill / source / version ──────────────────────────────────────────
//
// `skills` is keyed by UUID `id`. `name` is unique per owner. Binary content
// lives in `skill_versions.package`; `active_version_id` on the skill points
// to the published version currently serving. Every skill belongs to a
// `skill_sources` row (`kind in ('git','native')`).

export const SkillSourceKindSchema = z.enum(['git', 'native'])
export type SkillSourceKind = z.infer<typeof SkillSourceKindSchema>

export const ApiSkillSourceSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: SkillSourceKindSchema,
  // git-only
  git_type: z.string().nullable(),
  git_url: z.string().nullable(),
  git_host: z.string().nullable(),
  git_owner: z.string().nullable(),
  git_repo: z.string().nullable(),
  git_ref: z.string().nullable(),
  credential_name: z.string().nullable(),
  last_commit_sha: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  // native-only: whether draft_package is populated (bytes fetched on demand)
  has_draft: z.boolean(),
  // unfiltered skill count under this source — drives the UI's "real empty
  // vs filter-empty" distinction for source groups.
  skill_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiSkillSource = z.infer<typeof ApiSkillSourceSchema>

export const ApiSkillVersionSchema = z.object({
  id: z.string(),
  skill_id: z.string(),
  source_id: z.string(),
  content_hash: z.string(),
  commit_sha: z.string().nullable(),
  note: z.string().nullable(),
  published_at: z.string(),
  published_by: z.string(),
})
export type ApiSkillVersion = z.infer<typeof ApiSkillVersionSchema>

export const ApiSkillSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_kind: SkillSourceKindSchema,
  // NULL is a transient state during skill creation (cp creates the skill
  // row before scs writes the first version; UI should treat NULL as
  // "draft, no published version yet").
  active_version_id: z.string().nullable(),
  name: z.string(),
  subpath: z.string(),
  description: z.string(),
  user_id: z.string(),
  is_public: z.boolean(),
  visibility: SkillVisibilitySchema,
  my_permission: SkillMyPermissionSchema,
  shared_via_teams: z.array(SkillExportTokendTeamSchema),
  owner_name: z.string(),
  is_own: z.boolean(),
  category: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiSkill = z.infer<typeof ApiSkillSchema>

export const SkillGrantSchema = z.object({
  team_id: z.string(),
  permission: SkillPermissionSchema,
})
export type SkillGrant = z.infer<typeof SkillGrantSchema>

export const SkillGrantsBodySchema = z.object({
  grants: z.array(SkillGrantSchema),
})

export const ApiSkillGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: SkillPermissionSchema,
  granted_at: z.string(),
})
export type ApiSkillGrant = z.infer<typeof ApiSkillGrantSchema>

// Skill occupancy preview shown before deletion / visibility narrowing.
// Owner's own workspaces are named (no privacy concern); other users'
// workspaces collapse to a count so we don't leak who-uses-what across
// the user boundary. Template versions stay a count too.
export const SkillDependentsSchema = z.object({
  own_workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  other_workspace_count: z.number(),
  template_version_count: z.number(),
})
export type SkillDependents = z.infer<typeof SkillDependentsSchema>

// Public share of a single skill, consumed by local agents via
// `npx skills add <url>`. The URL *is* the credential — anyone holding it can
// download the skill — so `url` is only ever returned to the owner.
export const ApiSkillExportSchema = z.object({
  token: z.string(),
  url: z.string(),
  /** Name the skill installs under, and its directory name on disk. */
  slug: z.string(),
  label: z.string(),
  /** null = permanent; stays valid until revoked. */
  expires_at: z.string().nullable(),
  /** null until someone actually installs from it. */
  last_used_at: z.string().nullable(),
  created_at: z.string(),
})
export type ApiSkillExport = z.infer<typeof ApiSkillExportSchema>

// Expiry is expressed in days (not seconds like export_tokens): these are
// long-lived credentials that live on a developer machine, so the useful
// range is weeks-to-months rather than minutes.
export const SkillExportCreateBodySchema = z.object({
  /** Omit for the 90-day default; explicit null mints a permanent share. */
  ttl_days: z.number().int().min(1).max(3650).nullable().optional(),
  label: z.string().max(200).optional(),
  /**
   * Omit to derive it from the skill name. Required when the name yields
   * nothing usable (CJK, emoji, punctuation-only) — the API answers 400 with
   * the rules when that happens, so the UI can prompt for one.
   */
  slug: z.string().max(64).optional(),
})

// ── request schemas ───────────────────────────────────────────────────────

export const SkillScanGitBodySchema = z.object({
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
  credential_name: z.string().optional(),
})

export const SkillScanCandidateSchema = z.object({
  subpath: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  fileCount: z.number(),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
  skillMd: z.string().nullable(),
})

export const SkillScanResponseSchema = z.object({
  candidates: z.array(SkillScanCandidateSchema),
  requested_subpath: z.string().nullable().optional(),
  commit_sha: z.string().nullable().optional(),
})

export const SkillImportFromGitBodySchema = z.object({
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
  credential_name: z.string().optional(),
  subpath: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  visibility: SkillVisibilitySchema.optional(),
  category: z.string().nullable().optional(),
})

/**
 * 400 body shape for git-import when the repo has multiple SKILL.md and the
 * caller didn't pick a subpath. Web uses this to render an inline picker
 * without re-fetching the tarball.
 */
export const SkillFromGitErrorSchema = z.object({
  error: z.string(),
  candidates: z.array(SkillScanCandidateSchema).optional(),
})

/**
 * Switch an existing native skill to a git source in place. The skill keeps
 * its UUID — so every mount (workspace_skills / template_version_skills /
 * skill_grants) survives untouched — but its source-of-truth flips to git and
 * its native version history is wiped (only the freshly fetched git version
 * remains). Destructive: callers MUST confirm history loss with the user first.
 */
export const SkillSwitchToGitBodySchema = z.object({
  url: z.string().min(1),
  type: z.string().optional(),
  ref: z.string().optional(),
  token: z.string().optional(),
  credential_name: z.string().optional(),
  subpath: z.string(),
})

export const SkillCreateNativeBodySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  visibility: SkillVisibilitySchema,
  category: z.string().nullable().optional(),
})

export const SkillSyncBodySchema = z
  .object({
    token: z.string(),
    credential_name: z.string(),
  })
  .partial()

export const SkillSyncResponseSchema = z.object({
  source: ApiSkillSourceSchema,
  results: z.array(
    z.object({
      skill_id: z.string(),
      version_id: z.string(),
      content_hash: z.string(),
      changed: z.boolean(),
    }),
  ),
  commit_sha: z.string().nullable(),
})

export const SkillPatchBodySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    visibility: SkillVisibilitySchema,
    grants: z.array(SkillGrantSchema),
    // explicit null clears (returns the skill to uncategorized)
    category: z.string().nullable(),
  })
  .partial()

export const SkillPublishBodySchema = z
  .object({
    note: z.string().optional(),
  })
  .partial()

export const SkillActiveVersionBodySchema = z.object({
  version_id: z.string().min(1),
})

export const SourcePatchBodySchema = z
  .object({
    credential_name: z.string().nullable(),
    git_ref: z.string(),
  })
  .partial()

export const ApiCredentialMetaSchema = z.object({
  name: z.string(),
  inject: z.string(),
  path: z.string().nullable(),
  mode: z.string().nullable(),
  scope: z.enum(['global', 'selected']),
  workspace_ids: z.array(z.string()),
  updated_at: z.string(),
})

export type ApiCredentialMeta = z.infer<typeof ApiCredentialMetaSchema>

export const CredentialUpsertBodySchema = z.object({
  value: z.string().min(1),
  inject: z.enum(['env', 'file']),
  path: z.string().optional(),
  mode: z.string().optional(),
  scope: z.enum(['global', 'selected']).default('global'),
  workspace_ids: z.array(z.string()).optional(),
})

export interface ApiCredential {
  name: string
  value: string
  inject: string
  path: string | null
  mode: string | null
  scope: string
  status: string
}

// Provider visibility / grants — same shape as prompt, but team grants are
// restricted to 'viewer' at the route layer (see migrations/080).
export const ProviderVisibilitySchema = z.enum(['private', 'team', 'public'])
export type ProviderVisibility = z.infer<typeof ProviderVisibilitySchema>

export const ProviderPermissionSchema = z.enum(['viewer', 'editor'])
export type ProviderPermission = z.infer<typeof ProviderPermissionSchema>

const ProviderMyPermissionSchema = z.enum(['owner', 'editor', 'viewer', 'public'])

const ProviderSharedTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  permission: ProviderPermissionSchema,
})

export const ApiModelProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider_type: z.string(),
  base_url: z.string(),
  api_key: z.string(),
  user_id: z.string(),
  owner_name: z.string(),
  is_owner: z.boolean(),
  is_public: z.boolean(),
  visibility: ProviderVisibilitySchema,
  my_permission: ProviderMyPermissionSchema,
  shared_via_teams: z.array(ProviderSharedTeamSchema),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiModelProvider = z.infer<typeof ApiModelProviderSchema>

export const ProviderGrantSchema = z.object({
  team_id: z.string(),
  permission: ProviderPermissionSchema,
})
export type ProviderGrant = z.infer<typeof ProviderGrantSchema>

export const ProviderGrantsBodySchema = z.object({
  grants: z.array(ProviderGrantSchema),
})

export const ApiProviderGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: ProviderPermissionSchema,
  granted_at: z.string(),
})
export type ApiProviderGrant = z.infer<typeof ApiProviderGrantSchema>

export const ModelProviderCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  provider_type: z.string().default(''),
  base_url: z.string().default(''),
  api_key: z.string().default(''),
  is_public: z.boolean().optional(),
  visibility: ProviderVisibilitySchema.optional(),
  grants: z.array(ProviderGrantSchema).optional(),
})

export const ModelProviderUpdateBodySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    provider_type: z.string(),
    base_url: z.string(),
    api_key: z.string(),
    is_public: z.boolean(),
    visibility: ProviderVisibilitySchema,
    grants: z.array(ProviderGrantSchema),
  })
  .partial()

export const ModelProviderTestBodySchema = z.object({
  model: z.string().optional(),
  // Optional draft config: when present, probe these values instead of the
  // stored ones (lets the Edit Provider dialog test before saving). Omitted
  // fields fall back to the stored provider. A blank api_key keeps the stored
  // key (mirrors the edit-mode "blank = unchanged" convention).
  provider_type: z.string().optional(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
})

export const ModelListSchema = z.object({
  models: z.array(z.object({ id: z.string(), name: z.string() })),
  error: z.string().optional(),
})

export const ModelProviderTestResultSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
})

export const ModelProviderUsageSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const ModelProviderDeleteConflictSchema = z.object({
  error: z.string(),
  used_by: z.array(ModelProviderUsageSchema),
})

// Template visibility / grants — admits both 'viewer' and 'editor' (mirrors
// prompt). Unlike provider, editing a template doesn't expose any sensitive
// upstream credential, so the editor role is meaningful for collaborative
// agent-config refinement.
export const TemplateVisibilitySchema = z.enum(['private', 'team', 'public'])
export type TemplateVisibility = z.infer<typeof TemplateVisibilitySchema>

export const TemplatePermissionSchema = z.enum(['viewer', 'editor'])
export type TemplatePermission = z.infer<typeof TemplatePermissionSchema>

const TemplateMyPermissionSchema = z.enum(['owner', 'editor', 'viewer', 'public'])

const TemplateSharedTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  permission: TemplatePermissionSchema,
})

export const ApiTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  is_owner: z.boolean(),
  visibility: TemplateVisibilitySchema,
  my_permission: TemplateMyPermissionSchema,
  shared_via_teams: z.array(TemplateSharedTeamSchema),
  latest_version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiTemplate = z.infer<typeof ApiTemplateSchema>

export const TemplateGrantSchema = z.object({
  team_id: z.string(),
  permission: TemplatePermissionSchema,
})
export type TemplateGrant = z.infer<typeof TemplateGrantSchema>

export const TemplateGrantsBodySchema = z.object({
  grants: z.array(TemplateGrantSchema),
})

export const ApiTemplateGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: TemplatePermissionSchema,
  granted_at: z.string(),
})
export type ApiTemplateGrant = z.infer<typeof ApiTemplateGrantSchema>

// Returned by 4xx responses on link-visibility violations: lists exactly which
// referenced resource fails to be visible to which grant target.
export const TemplateLinkMissingItemSchema = z.object({
  resource: z.enum(['prompt', 'provider', 'skill']),
  resource_id: z.string(),
  resource_name: z.string(),
  scope: z.union([
    z.object({ kind: z.literal('public') }),
    z.object({ kind: z.literal('team'), team_id: z.string(), team_name: z.string() }),
  ]),
})
export type TemplateLinkMissingItem = z.infer<typeof TemplateLinkMissingItemSchema>

export const TemplateLinkErrorSchema = z.object({
  error: z.string(),
  missing: z.array(TemplateLinkMissingItemSchema),
})

export const ApiTemplateVersionCommandSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['plain', 'struct']),
  prompt_id: z.string().nullable(),
  content: z.string(),
  sort_order: z.number().int(),
})

export type ApiTemplateVersionCommand = z.infer<typeof ApiTemplateVersionCommandSchema>

export const ApiTemplateVersionScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  timezone: z.string(),
  prompt: z.string(),
  prompt_id: z.string().nullable(),
  enabled_default: z.boolean(),
  sort_order: z.number().int(),
})

export type ApiTemplateVersionSchedule = z.infer<typeof ApiTemplateVersionScheduleSchema>

export const ApiTemplateVersionSchema = z.object({
  id: z.string(),
  template_id: z.string(),
  version: z.number().int(),
  agent_type: z.string(),
  system_prompt: z.string(),
  prompt_id: z.string().nullable(),
  prompt_version: z.number().int().nullable(),
  mcp_config: z.string(),
  agent_settings: z.string(),
  compute_resources: z.record(z.string(), z.any()),
  provider_id: z.string().nullable(),
  provider_name: z.string().nullable(),
  model: z.string(),
  small_model: z.string(),
  /** Skill UUIDs the version pins (authoritative). */
  skill_ids: z.array(z.string()),
  /** Display names parallel to `skill_ids` (same order). Denormalized via JOIN. */
  skill_names: z.array(z.string()),
  /** Command set this version distributes. */
  commands: z.array(ApiTemplateVersionCommandSchema),
  /** Schedule set this version distributes. */
  schedules: z.array(ApiTemplateVersionScheduleSchema),
  /**
   * The workspace_layout row this version ships (a link, resolved + copied
   * into a recipient-owned row at create/sync). null = no layout shipped.
   */
  layout_id: z.string().nullable(),
  created_at: z.string(),
})

export type ApiTemplateVersion = z.infer<typeof ApiTemplateVersionSchema>

export const TemplateCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: TemplateVisibilitySchema.optional(),
})

export const TemplateUpdateBodySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    visibility: TemplateVisibilitySchema,
    grants: z.array(TemplateGrantSchema),
  })
  .partial()

export const TemplateVersionCreateBodySchema = z
  .object({
    agent_type: z.string(),
    system_prompt: z.string(),
    prompt_id: z.string().nullable(),
    prompt_version: z.number().int().nullable(),
    mcp_config: z.string(),
    agent_settings: z.string(),
    compute_resources: z.record(z.string(), z.any()),
    provider_id: z.string().nullable(),
    model: z.string(),
    small_model: z.string(),
    // p3: clients should send `skill_ids`. `skill_names` is kept transitionally
    // for legacy callers; routes prefer ids when both are present.
    skill_ids: z.array(z.string()),
    skill_names: z.array(z.string()),
    // Build path. When `from_workspace_id` is set the server snapshots that
    // workspace's effective state into the new version (one-shot read, no
    // persisted source binding). The three `include_*` flags gate which
    // capability categories are snapshotted; core agent config is always taken.
    from_workspace_id: z.string(),
    include_commands: z.boolean(),
    include_schedules: z.boolean(),
    include_layout: z.boolean(),
    // Explicit command set (power-user escape hatch; ignored when
    // `from_workspace_id` + `include_commands` drive the snapshot).
    commands: z.array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['plain', 'struct']).optional(),
        prompt_id: z.string().nullable().optional(),
        content: z.string().optional(),
        sort_order: z.number().int().optional(),
      }),
    ),
    // Explicit schedule set (recurring cron only). Ignored when
    // `from_workspace_id` + `include_schedules` drive the snapshot.
    schedules: z.array(
      z.object({
        name: z.string().min(1),
        cron: z.string().min(1),
        timezone: z.string().optional(),
        prompt: z.string().optional(),
        prompt_id: z.string().nullable().optional(),
        enabled_default: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      }),
    ),
  })
  .partial()

export const TemplateUsageItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
})

export const WORKSPACE_COMMAND_TYPES = ['plain', 'struct'] as const

export const ApiWorkspaceCommandSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  name: z.string(),
  type: z.enum(WORKSPACE_COMMAND_TYPES),
  prompt_id: z.string().nullable(),
  prompt_content: z.string().nullable(),
  content: z.string(),
  sort_order: z.number().int(),
  /** Where the resolved command came from: the user's own row, or template base. */
  source: z.enum(['local', 'template']),
  /** True for a template command the user disabled (still listed for management UI). */
  disabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiWorkspaceCommand = z.infer<typeof ApiWorkspaceCommandSchema>

export const WorkspaceCommandCreateBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(WORKSPACE_COMMAND_TYPES).optional(),
  prompt_id: z.string().nullable().optional(),
  content: z.string().optional(),
  sort_order: z.number().int().optional(),
})

export const WorkspaceCommandPatchBodySchema = z
  .object({
    name: z.string(),
    type: z.enum(WORKSPACE_COMMAND_TYPES),
    prompt_id: z.string().nullable(),
    content: z.string(),
    sort_order: z.number().int(),
    /** Enable/disable a local command without deleting it. */
    disabled: z.boolean(),
  })
  .partial()

/**
 * Workspace UI/preferences profile — opaque jsonb owned by the client. The
 * server does shallow-merge on PATCH so unknown keys (newer clients,
 * concurrent tabs) survive partial writes.
 */
export const WorkspaceProfilePayloadSchema = z.record(z.string(), z.unknown())
export type WorkspaceProfilePayload = z.infer<typeof WorkspaceProfilePayloadSchema>

export const ApiWorkspaceProfileSchema = z.object({
  payload: WorkspaceProfilePayloadSchema,
})
export type ApiWorkspaceProfile = z.infer<typeof ApiWorkspaceProfileSchema>

/**
 * Per-user UI/preferences profile — same opaque-payload shape as the
 * workspace profile, scoped to the current user instead of a workspace.
 * Powers the fleet (global) shell so layouts / sidebars / per-instance
 * state survive logins and tabs.
 */
export const UserProfilePayloadSchema = z.record(z.string(), z.unknown())
export type UserProfilePayload = z.infer<typeof UserProfilePayloadSchema>

export const ApiUserProfileSchema = z.object({
  payload: UserProfilePayloadSchema,
})
export type ApiUserProfile = z.infer<typeof ApiUserProfileSchema>

// ── Workspace layout (reusable named skeleton) ──
//
// A layout is the user-facing "saved arrangement" resource. The recipient-side
// pointer `selected_layout_id` lives inside the (schemaless) workspace_profile
// payload; the `real` arrangement is the profile's `layout_id` + `slots`.

/**
 * A layout skeleton: which column frame and which apps open in each slot.
 * Deliberately excludes accumulated state (active tab, per-instance cwd/scroll,
 * popout geometry). `slots` maps slotId → ordered appId list (a repeated appId
 * means two instances of that app in the slot).
 */
export const LayoutSkeletonSchema = z.object({
  layout_id: z.string(),
  slots: z.record(z.string(), z.array(z.string())),
})
export type LayoutSkeleton = z.infer<typeof LayoutSkeletonSchema>

/** The virtual slot holding popped-out instances — never part of a skeleton. */
export const POPOUT_SLOT_ID = 'popout'

/** Column frame used when a profile has no `layout_id` yet (mirrors web DEFAULT_LAYOUT). */
export const DEFAULT_LAYOUT_ID = '3col'

/**
 * Canonical form for equality: drop the popout slot, drop empty slots, sort
 * slot keys. Two skeletons are "the same layout" iff their canonical JSON is
 * equal. Shared by the frontend (live same/edited) and the backend (sync).
 */
export function normalizeLayoutSkeleton(s: LayoutSkeleton): LayoutSkeleton {
  const slots: Record<string, string[]> = {}
  for (const key of Object.keys(s.slots ?? {}).sort()) {
    if (key === POPOUT_SLOT_ID) continue
    const apps = s.slots[key] ?? []
    if (apps.length === 0) continue
    slots[key] = apps
  }
  return { layout_id: s.layout_id, slots }
}

/** True iff a and b are the same layout (after normalization). */
export function layoutSkeletonEqual(a: LayoutSkeleton, b: LayoutSkeleton): boolean {
  return JSON.stringify(normalizeLayoutSkeleton(a)) === JSON.stringify(normalizeLayoutSkeleton(b))
}

/**
 * Extract a skeleton from a raw workspace_profile payload (the live "real"
 * arrangement), reading `layout_id` and each slot's `opened[].appId` and
 * ignoring active tab / per-instance state / popout. Used by the backend on
 * the sync path, where a template-created workspace always has materialized
 * `slots`. (The frontend computes its real skeleton from live slot states so
 * it also accounts for not-yet-persisted layout defaults.)
 */
export function extractSkeletonFromProfile(
  payload: Record<string, unknown>,
  fallbackLayoutId: string,
): LayoutSkeleton {
  const layout_id = typeof payload.layout_id === 'string' ? payload.layout_id : fallbackLayoutId
  const slots: Record<string, string[]> = {}
  const rawSlots = (payload.slots ?? {}) as Record<string, unknown>
  for (const [slotId, slot] of Object.entries(rawSlots)) {
    if (slotId === POPOUT_SLOT_ID) continue
    const opened = (slot as { opened?: unknown })?.opened
    if (!Array.isArray(opened)) continue
    const apps = opened
      .map((i) => (i as { appId?: unknown })?.appId)
      .filter((a): a is string => typeof a === 'string')
    if (apps.length > 0) slots[slotId] = apps
  }
  return normalizeLayoutSkeleton({ layout_id, slots })
}

/**
 * Materialize a skeleton into the profile `slots` shape, minting instance ids
 * via the injected factory (server mints deterministic ids, client random ones).
 * Each slot's first instance becomes active. Returns the `{ layout_id, slots }`
 * patch to merge into a workspace_profile payload.
 */
export function skeletonToProfilePatch(
  skeleton: LayoutSkeleton,
  mkId: (slotId: string, appId: string, index: number) => string,
): {
  layout_id: string
  slots: Record<string, { opened: { id: string; appId: string }[]; active: string | null }>
} {
  const slots: Record<string, { opened: { id: string; appId: string }[]; active: string | null }> =
    {}
  for (const [slotId, apps] of Object.entries(skeleton.slots)) {
    const opened = apps.map((appId, i) => ({ id: mkId(slotId, appId, i), appId }))
    slots[slotId] = { opened, active: opened[0]?.id ?? null }
  }
  return { layout_id: skeleton.layout_id, slots }
}

export const ApiWorkspaceLayoutSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  description: z.string(),
  skeleton: LayoutSkeletonSchema,
  /** 'local' = the user's own (custom); 'template' = copied from a template (preset-class). */
  origin: z.enum(['local', 'template']),
  source_template_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiWorkspaceLayout = z.infer<typeof ApiWorkspaceLayoutSchema>

export const WorkspaceLayoutCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  skeleton: LayoutSkeletonSchema,
})

export const WorkspaceLayoutUpdateBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    skeleton: LayoutSkeletonSchema,
  })
  .partial()

export const ApiRecentSessionItemSchema = z.object({
  session_id: z.string(),
  workspace_id: z.string(),
  workspace_name: z.string(),
  session_name: z.string(),
  chat_status: z.string(),
  preview: z.string(),
  last_active_at: z.string(),
})
export type ApiRecentSessionItem = z.infer<typeof ApiRecentSessionItemSchema>

export const ApiActivitySummarySchema = z.object({
  daily: z.array(
    z.object({
      date: z.string(),
      interactions: z.number().int(),
      sessions: z.number().int(),
    }),
  ),
  punch_card: z.array(
    z.object({
      dow: z.number().int(),
      hour: z.number().int(),
      count: z.number().int(),
    }),
  ),
})
export type ApiActivitySummary = z.infer<typeof ApiActivitySummarySchema>

/** Per-user token-usage summary for the Stats app. Tokens are "all-in"
 * (input+output+cache); see GET /me/usage-summary. */
export const ApiUsageSummarySchema = z.object({
  daily: z.array(
    z.object({
      date: z.string(),
      tokens: z.number().int(),
    }),
  ),
  composition: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cacheRead: z.number().int(),
    cacheCreation: z.number().int(),
  }),
  byWorkspace: z.array(
    z.object({
      workspaceId: z.string(),
      name: z.string(),
      tokens: z.number().int(),
    }),
  ),
})
export type ApiUsageSummary = z.infer<typeof ApiUsageSummarySchema>

export const ApiShareSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  created_at: z.string(),
  session_id: z.string().optional(),
})

export type ApiShare = z.infer<typeof ApiShareSchema>

export const ApiShareConfigSchema = z.object({
  agent_type: z.string(),
  model: z.string(),
  system_prompt: z.string(),
  skills: z.array(z.string()),
  template_name: z.string().nullable(),
  template_version: z.number().int().nullable(),
})

export type ApiShareConfig = z.infer<typeof ApiShareConfigSchema>

export const ApiShareTriggerSchema = z.object({
  type: z.string(),
  schedule_name: z.string().optional(),
  created_at: z.string().optional(),
})

export type ApiShareTrigger = z.infer<typeof ApiShareTriggerSchema>

export const ApiShareDataSchema = z
  .object({
    title: z.string(),
    created_at: z.string(),
    owner_name: z.string(),
    messages: z.array(ApiMessageSchema),
    turnStats: ContextGaugeSchema.nullable(),
    workspaceConfig: ApiShareConfigSchema.nullable(),
    trigger: ApiShareTriggerSchema.nullable(),
  })
  .passthrough()

export type ApiShareData = z.infer<typeof ApiShareDataSchema>

export const ShareCreateBodySchema = z.object({
  workspace_id: z.string().min(1),
  session_id: z.string().min(1),
  title: z.string().optional(),
})

export const ShareListQuerySchema = z.object({
  workspace_id: z.string().min(1),
  session_id: z.string().min(1).optional(),
})

export const SharePatchBodySchema = z.object({
  title: z.string(),
})

export const ApiScheduleSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  name: z.string(),
  // Recurring schedules carry `cron`; one-time schedules carry `run_at` (ISO
  // timestamp). Exactly one is set — enforced by DB CHECK.
  cron: z.string().nullable(),
  run_at: z.string().nullable(),
  timezone: z.string(),
  prompt: z.string(),
  prompt_id: z.string().nullable(),
  prompt_content: z.string().nullable(),
  enabled: z.boolean(),
  /** 'local' = user's own; 'template' = materialized from the template (read-only except enable/disable). */
  origin: z.enum(['local', 'template']),
  last_run_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiSchedule = z.infer<typeof ApiScheduleSchema>

// Per-field max value for a standard 5-field cron expression (minute, hour,
// day-of-month, month, day-of-week). The `cron-parser` lib both the web
// preview and pg-boss (server-side execution) run on doesn't reject a step
// larger than a field's range — e.g. "0/120" in the minute field silently
// walks 0,120,240,... within 0-59 and only ever matches minute 0, collapsing
// "every 120 minutes" into "every hour" with no error, no matter which side
// parses it. Reject that shape up front instead of letting it silently fire
// at the wrong interval.
const CRON_FIELD_MAX = [59, 23, 31, 12, 7]

export function hasOutOfRangeCronStep(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.some((field, i) => {
    const step = field.match(/\/(\d+)$/)
    return step ? Number(step[1]) > CRON_FIELD_MAX[i] : false
  })
}

export const ScheduleCreateBodySchema = z
  .object({
    name: z.string().min(1),
    // Nullable so the client can send `{ cron: null, run_at: <iso> }` or vice
    // versa without juggling key omission — useful when the form maintains
    // both as state and emits exactly one as the "active" field per mode.
    cron: z.string().min(1).nullable().optional(),
    run_at: z.string().datetime().nullable().optional(),
    timezone: z.string().optional(),
    prompt: z.string().optional(),
    prompt_id: z.string().nullable().optional(),
  })
  .refine((v) => !!v.cron !== !!v.run_at, {
    message: 'Provide exactly one of cron or run_at',
    path: ['cron'],
  })
  .refine((v) => !v.cron || !hasOutOfRangeCronStep(v.cron), {
    message: 'cron step exceeds a field\'s valid range (e.g. minute step > 59)',
    path: ['cron'],
  })

export const ScheduleUpdateBodySchema = z
  .object({
    name: z.string(),
    // Nullable: explicitly clearing one column is how the mode switch lands —
    // PATCH `{ cron: null, run_at: <iso> }` swaps a recurring schedule into a
    // one-time one (and the DB CHECK rejects any state that violates xor).
    cron: z.string().nullable(),
    run_at: z.string().datetime().nullable(),
    timezone: z.string(),
    prompt: z.string(),
    prompt_id: z.string().nullable(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => !v.cron || !hasOutOfRangeCronStep(v.cron), {
    message: 'cron step exceeds a field\'s valid range (e.g. minute step > 59)',
    path: ['cron'],
  })

// ─── Chat ───────────────────────────────────────────────────────────

export const CHAT_SOURCES = [
  'api',
  'web',
  'slack',
  'wecom',
  'webhook',
  'schedule',
  'batch',
  'manual',
] as const

export const ChatImageSchema = z.object({
  data: z.string(),
  media_type: z.string(),
})

/**
 * Response delivery mode for a chat turn:
 *   - `stream` — SSE (`text/event-stream`) of UniversalEvent frames. The most
 *     flexible mode and the default.
 *   - `sync`   — block until the turn ends, return the aggregated JSON
 *     (`ChatJsonResponse`). Simple but weak: the whole turn must finish before
 *     the caller gets anything, and a long turn ties up the connection. Kept
 *     for compatibility; prefer `stream` or `async`.
 *   - `async`  — (recommended) fire-and-forget. Return `202` with
 *     `{ session_id }` as soon as the session exists; the turn keeps running +
 *     persisting server-side. The caller reads results later via
 *     `GET /sessions/:id` (poll `status`) and `GET /messages?session_id=`, or
 *     attaches mid-turn via SSE reconnect.
 */
export const CHAT_MODES = ['stream', 'sync', 'async'] as const
export type ChatMode = (typeof CHAT_MODES)[number]

export const ChatBodySchema = z.object({
  message: z.string().min(1),
  /** Existing session to continue; null / omitted means a new session. */
  session_id: z.string().nullable().optional(),
  images: z.array(ChatImageSchema).optional(),
  /** Origin of the turn. Defaults to `api` for direct API callers. */
  source: z.enum(CHAT_SOURCES).optional().default('api'),
  /**
   * Response delivery mode. When set, takes precedence over `stream` and the
   * `Accept` header. Defaults to `stream`.
   */
  mode: z.enum(CHAT_MODES).optional(),
  /**
   * @deprecated Use `mode` instead. Legacy stream toggle, honored only when
   * `mode` is absent: `true` forces SSE (`stream`), `false` forces JSON
   * (`sync`). If both are omitted the server falls back to the `Accept`
   * header, defaulting to SSE.
   */
  stream: z.boolean().optional(),
})
export type ChatBody = z.infer<typeof ChatBodySchema>

/**
 * Response for non-streaming chat (`stream: false` or `Accept: application/json`).
 * The handler consumes the agent SSE internally and aggregates into this shape.
 */
export const ChatJsonResponseSchema = z.object({
  session_id: z.string(),
  /** Assembled text of the assistant's reply for the turn. */
  final_message: z.string(),
  /** Messages newly persisted during this turn (user input + assistant reply). */
  messages: z.array(ApiMessageSchema),
  stats: TurnStatsSchema.nullable(),
  /** Why the turn ended. 'ended' is the normal success case. */
  reason: z.enum(['ended', 'timeout', 'error', 'disconnected']),
  /** Populated when reason !== 'ended'. */
  error: z.string().nullable(),
})
export type ChatJsonResponse = z.infer<typeof ChatJsonResponseSchema>

/**
 * Response for async chat (`mode: 'async'`). Returned with `202 Accepted` once
 * the session exists; the turn continues running + persisting server-side.
 * Poll `GET /sessions/:id` for `status` and read `GET /messages?session_id=`
 * when it leaves the running state.
 */
export const ChatAsyncResponseSchema = z.object({
  session_id: z.string(),
  /** Always `running` — the turn was accepted and is in progress. */
  status: z.literal('running'),
})
export type ChatAsyncResponse = z.infer<typeof ChatAsyncResponseSchema>

// ─── Agent file passthrough ─────────────────────────────────────────

export const AgentDirEntrySchema = z.object({
  name: z.string(),
  path_type: z.enum(['Dir', 'File', 'SymLink', 'SymlinkDir']),
  mtime: z.number(),
  size: z.number(),
})
export type AgentDirEntry = z.infer<typeof AgentDirEntrySchema>

export const AgentDirListingSchema = z.object({
  entries: z.array(AgentDirEntrySchema),
})
export type AgentDirListing = z.infer<typeof AgentDirListingSchema>

export const AgentMkdirBodySchema = z.object({
  path: z.string().min(1),
})

export const AgentMoveBodySchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
})

export const ApiApplicationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  homepage_url: z.string().nullable(),
  redirect_uris: z.array(z.string()),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  owner_display_name: z.string().nullable(),
  owner_username: z.string().nullable(),
})

export type ApiApplication = z.infer<typeof ApiApplicationSchema>

export const ApiApplicationSecretSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  homepage_url: z.string().nullable().optional(),
  redirect_uris: z.array(z.string()).optional(),
  client_secret: z.string(),
})

export type ApiApplicationSecret = z.infer<typeof ApiApplicationSecretSchema>

export const ApplicationCreateBodySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  homepage_url: z.string().nullable().optional(),
  redirect_uris: z.array(z.string()).min(1),
})

export const ApplicationUpdateBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable(),
    homepage_url: z.string().nullable(),
    redirect_uris: z.array(z.string()).min(1),
  })
  .partial()

// ── Teams ────────────────────────────────────────────────────────────────────

export const TeamRoleSchema = z.enum(['admin', 'member'])
export type TeamRole = z.infer<typeof TeamRoleSchema>

export const ApiTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  my_role: TeamRoleSchema,
  member_count: z.number().int(),
})
export type ApiTeam = z.infer<typeof ApiTeamSchema>

export const TeamCreateBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

export const TeamPatchBodySchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
  })
  .partial()

export const ApiTeamMemberSchema = z.object({
  user_id: z.string(),
  user_name: z.string(),
  role: TeamRoleSchema,
  joined_at: z.string(),
})
export type ApiTeamMember = z.infer<typeof ApiTeamMemberSchema>

export const TeamMemberAddBodySchema = z.object({
  user_id: z.string().min(1),
  role: TeamRoleSchema.optional(),
})

export const TeamMemberPatchBodySchema = z.object({
  role: TeamRoleSchema,
})

export const ApiTeamInviteSchema = z.object({
  token: z.string(),
  team_id: z.string(),
  created_by: z.string(),
  created_by_name: z.string(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
})
export type ApiTeamInvite = z.infer<typeof ApiTeamInviteSchema>

export const TeamInviteCreateBodySchema = z.object({
  expires_in_days: z.number().int().min(1).max(30).optional(),
})

export const ApiTeamInvitePreviewSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  inviter_name: z.string(),
  expires_at: z.string().nullable(),
  already_member: z.boolean(),
})
export type ApiTeamInvitePreview = z.infer<typeof ApiTeamInvitePreviewSchema>

export interface ApiError {
  error: string
}

export interface ApiSuccess {
  success: boolean
}

// ── Memory stores (P0) ──────────────────────────────────────────────────────

export const MemoryAccessSchema = z.enum(['read_only', 'read_write'])
export type MemoryAccess = z.infer<typeof MemoryAccessSchema>

export const ApiMemoryStoreSchema = z.object({
  id: z.string(),
  owner_user_id: z.string(),
  name: z.string(),
  description: z.string(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  // counts populated by list/get endpoints
  memory_count: z.number().int().nonnegative(),
})
export type ApiMemoryStore = z.infer<typeof ApiMemoryStoreSchema>

export const MemoryStoreCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

export const MemoryStorePatchBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  archived: z.boolean().optional(),
})

export const ApiMemorySchema = z.object({
  id: z.string(),
  store_id: z.string(),
  path: z.string(),
  content: z.string(),
  content_sha256: z.string(),
  size_bytes: z.number().int().nonnegative(),
  description: z.string(),
  mem_type: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiMemory = z.infer<typeof ApiMemorySchema>

export const ApiMemoryLiteSchema = ApiMemorySchema.omit({ content: true })
export type ApiMemoryLite = z.infer<typeof ApiMemoryLiteSchema>

// Path is in the URL; body carries content + optional metadata + sha precondition.
// if_match_sha256: required for update of an existing path; absent => create-only
// (server returns 409 if path already exists). Pass the empty-string sentinel
// '' to assert "must not exist" explicitly on a PUT.
export const MemoryPutBodySchema = z.object({
  content: z.string(),
  description: z.string().max(2000).optional(),
  mem_type: z.string().max(40).optional(),
  if_match_sha256: z.string().optional(),
})

export const MemoryDeleteBodySchema = z.object({
  if_match_sha256: z.string().optional(),
})

export const ApiMemoryVersionSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  memory_id: z.string().nullable(),
  path: z.string(),
  operation: z.enum(['create', 'update', 'delete', 'rename', 'migrate']),
  content_sha256: z.string().nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  actor_kind: z.enum(['user', 'agent', 'reflect', 'migrate']),
  actor_id: z.string().nullable(),
  created_at: z.string(),
  // Per-path sequential numbering when fetched with path filter; null in store-wide mode.
  version_number: z.number().int().positive().nullable(),
})
export type ApiMemoryVersion = z.infer<typeof ApiMemoryVersionSchema>

export const ApiMemoryVersionDetailSchema = ApiMemoryVersionSchema.extend({
  content: z.string().nullable(),
  version_number: z.number().int().positive(),
})
export type ApiMemoryVersionDetail = z.infer<typeof ApiMemoryVersionDetailSchema>

export const MemoryRollbackBodySchema = z.object({
  version_id: z.string(),
})

export const ApiWorkspaceMemoryAttachmentSchema = z.object({
  workspace_id: z.string(),
  store_id: z.string(),
  store_name: z.string(),
  access: MemoryAccessSchema,
  instructions: z.string(),
  created_at: z.string(),
})
export type ApiWorkspaceMemoryAttachment = z.infer<typeof ApiWorkspaceMemoryAttachmentSchema>

// Inverse view: the workspaces a given store is attached to. Used by the
// Memory app store detail to show / manage attachment from the store side.
export const ApiMemoryStoreAttachmentSchema = z.object({
  workspace_id: z.string(),
  workspace_name: z.string(),
  access: MemoryAccessSchema,
  instructions: z.string(),
  created_at: z.string(),
})
export type ApiMemoryStoreAttachment = z.infer<typeof ApiMemoryStoreAttachmentSchema>

export const WorkspaceMemoryAttachBodySchema = z.object({
  store_id: z.string(),
  access: MemoryAccessSchema.optional(),
  instructions: z.string().max(4000).optional(),
})

export const WorkspaceMemoryAttachmentPatchBodySchema = z.object({
  access: MemoryAccessSchema.optional(),
  instructions: z.string().max(4000).optional(),
})

// CMA caps a single agent at 8 mounted stores; we mirror.
export const WORKSPACE_MEMORY_ATTACHMENT_MAX = 8

// ── Teamwork ────────────────────────────────────────────────────────────────

export const ApiTeamworkTaskSchema = z.object({
  id: z.string(),
  owner_user_id: z.string(),
  name: z.string(),
  brief: z.string().nullable(),
  coordinator_workspace_id: z.string(),
  afs_share_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ApiTeamworkTask = z.infer<typeof ApiTeamworkTaskSchema>

export const TeamworkSessionRoleSchema = z.enum(['coordinator', 'member'])
export type TeamworkSessionRole = z.infer<typeof TeamworkSessionRoleSchema>

export const ApiTeamworkSessionSchema = z.object({
  task_id: z.string(),
  session_id: z.string(),
  role: TeamworkSessionRoleSchema,
  parent_session_id: z.string().nullable(),
  created_at: z.string(),
})
export type ApiTeamworkSession = z.infer<typeof ApiTeamworkSessionSchema>

export const TeamworkSessionRegisterBodySchema = z.object({
  session_id: z.string().min(1),
  /** Defaults to 'coordinator' — alpha only writes coordinator sessions. */
  role: TeamworkSessionRoleSchema.optional(),
  /** Reserved for member sessions; set to the spawning coordinator session. */
  parent_session_id: z.string().min(1).nullable().optional(),
})

export const TeamworkTaskCreateBodySchema = z.object({
  name: z.string().min(1).max(100),
  brief: z.string().max(2000).optional(),
  coordinator_workspace_id: z.string().min(1),
})

export const TeamworkTaskPatchBodySchema = z
  .object({
    name: z.string().min(1).max(100),
    brief: z.string().max(2000).nullable(),
  })
  .partial()

export const ApiTeamworkParticipantSchema = z.object({
  workspace_id: z.string(),
  workspace_name: z.string(),
  workspace_slug: z.string().nullable(),
  workspace_visibility: z.string(),
  joined_at: z.string(),
})
export type ApiTeamworkParticipant = z.infer<typeof ApiTeamworkParticipantSchema>

export const TeamworkParticipantAddBodySchema = z.object({
  workspace_id: z.string().min(1),
})

/**
 * Workspace eligible to join a teamwork roster. Same shape as CallableAgent
 * but with relaxed visibility rules — includes own private workspaces, since
 * a coordinator dispatching to its own private agent stays within one user.
 */
export const ApiTeamworkRosterCandidateSchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  name: z.string(),
  owner: z.string(),
  visibility: z.string(),
  is_own: z.boolean(),
  status: z.string(),
})
export type ApiTeamworkRosterCandidate = z.infer<typeof ApiTeamworkRosterCandidateSchema>

// ── Agent requests ─────────────────────────────────────────────────────────
// Generic human-in-loop primitive. A workspace tool (e.g. Builder Mode's
// `*_propose` family) writes a request; the user resolves it from chat UI;
// a paired `*_apply` tool (or any consumer) reads the approved payload to
// do the actual work. cp owns create/get/resolve only — never apply.

export const ApiAgentRequestSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'approved', 'rejected', 'applied']),
  reject_reason: z.string().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  applied_at: z.string().nullable().optional(),
})
export type ApiAgentRequest = z.infer<typeof ApiAgentRequestSchema>

export const AgentRequestResolveBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
})

// ── Environments (BYOI) ──

export const EnvironmentVisibilitySchema = z.enum(['private', 'team', 'public'])
export type EnvironmentVisibility = z.infer<typeof EnvironmentVisibilitySchema>

export const EnvironmentMyPermissionSchema = z.enum(['owner', 'editor', 'viewer', 'public'])
export type EnvironmentMyPermission = z.infer<typeof EnvironmentMyPermissionSchema>

export const EnvironmentSharedTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  permission: z.enum(['viewer', 'editor']),
})

export const ApiEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: EnvironmentVisibilitySchema,
  kind: z.string(),
  status: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  is_builtin: z.boolean(),
  last_heartbeat_at: z.string().nullable(),
  owner_name: z.string(),
  is_own: z.boolean(),
  my_permission: EnvironmentMyPermissionSchema,
  shared_via_teams: z.array(EnvironmentSharedTeamSchema),
  created_at: z.string(),
})
export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>

export const EnvironmentPermissionSchema = z.enum(['viewer', 'editor'])

export const EnvironmentGrantSchema = z.object({
  team_id: z.string(),
  permission: EnvironmentPermissionSchema,
})
export type EnvironmentGrant = z.infer<typeof EnvironmentGrantSchema>

export const EnvironmentGrantsBodySchema = z.object({
  grants: z.array(EnvironmentGrantSchema),
})

export const ApiEnvironmentGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: EnvironmentPermissionSchema,
  granted_at: z.string(),
})
export type ApiEnvironmentGrant = z.infer<typeof ApiEnvironmentGrantSchema>

export const EnvironmentCreateBodySchema = z.object({
  name: z.string().min(1),
  // Only remote, non-builtin environments are created via the API; built-in is
  // seeded by migration. kind selects the provider the runner will use.
  kind: z.string().min(1).default('kubernetes'),
  visibility: EnvironmentVisibilitySchema.optional(),
  placement: z.record(z.string(), z.unknown()).optional(),
  grants: z.array(EnvironmentGrantSchema).optional(),
})

export const EnvironmentUpdateBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    visibility: EnvironmentVisibilitySchema.optional(),
    placement: z.record(z.string(), z.unknown()).optional(),
    grants: z.array(EnvironmentGrantSchema).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'no fields to update' })

// ── Environment tokens (runner credentials) ──

export const EnvironmentTokenCreateBodySchema = z.object({
  name: z.string().min(1),
})

/** Token metadata — never includes the secret. */
export const ApiEnvironmentTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
})
export type ApiEnvironmentToken = z.infer<typeof ApiEnvironmentTokenSchema>

/** Returned exactly once on creation — carries the plaintext secret. */
export const CreatedEnvironmentTokenSchema = z.object({
  id: z.string(),
  token: z.string(),
  created_at: z.string(),
})
export type CreatedEnvironmentToken = z.infer<typeof CreatedEnvironmentTokenSchema>
