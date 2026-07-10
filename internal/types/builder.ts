import { z } from 'zod'

/**
 * Builder Mode caps. Opt-in via the `X-Builder` header on the `tos-platform`
 * MCP entry in mcp_config; cp parses the header, web edits it via the multi-
 * select in the workspace settings editor. Keep this union as the single
 * source of truth across both sides.
 *
 *  - `workspace`: tools that shape the current workspace's own config
 *    (prompt / commands / settings / skills).
 *  - `global`: tools that touch account-wide resources spanning workspaces
 *    (credentials / providers / prompt lib / shares).
 */
export type BuilderCap = 'workspace' | 'global'

export const BUILDER_CAPS: readonly BuilderCap[] = ['workspace', 'global'] as const

const BUILDER_CAP_SET: ReadonlySet<string> = new Set(BUILDER_CAPS)

/**
 * Parse a comma-separated `X-Builder` header value into a deduped, ordered
 * list of known caps. Unknown tokens are silently dropped so a stale header
 * never breaks dispatch.
 */
export function parseBuilderHeader(value: string | null | undefined): BuilderCap[] {
  if (!value) return []
  const seen = new Set<BuilderCap>()
  const out: BuilderCap[] = []
  for (const raw of value.split(',')) {
    const token = raw.trim()
    if (!BUILDER_CAP_SET.has(token)) continue
    const cap = token as BuilderCap
    if (seen.has(cap)) continue
    seen.add(cap)
    out.push(cap)
  }
  return out
}

// ── Action payload schemas ─────────────────────────────────────────────────
// Shared by cp (action descriptors) and web (per-kind body renderers) so the
// `agent_requests.payload` contract is single-sourced. Add the schema next to
// its `kind` constant when introducing a new Builder Mode action.

export const BUILDER_KIND_SCHEDULE_CREATE = 'builder.workspace.schedule.create' as const

export const ScheduleCreatePayloadSchema = z
  .object({
    name: z.string().min(1).describe('Schedule display name.'),
    cron: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Standard cron expression for a recurring schedule, e.g. "0 9 * * *". Provide this OR `run_at`, not both.',
      ),
    run_at: z
      .string()
      .datetime()
      .optional()
      .describe(
        'ISO 8601 timestamp for a one-time schedule, e.g. "2026-05-25T06:00:00Z". The schedule fires once at this instant and is then auto-completed. Provide this OR `cron`, not both.',
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone, e.g. "Asia/Singapore". Required for `cron` (no UTC fallback — ask the user if missing). For `run_at` this is metadata only, since the ISO timestamp already pins the instant.',
      ),
    prompt: z
      .string()
      .optional()
      .describe('Raw prompt text to run on each tick. Provide this OR prompt_id, not both.'),
    prompt_id: z
      .string()
      .optional()
      .describe(
        'Reference an existing prompt from the user library by id. Provide this OR prompt, not both.',
      ),
  })
  .refine((v) => Boolean(v.cron) !== Boolean(v.run_at), {
    message: 'Exactly one of `cron` or `run_at` must be provided.',
  })
  .refine(
    (v: { prompt?: string; prompt_id?: string }) => Boolean(v.prompt) !== Boolean(v.prompt_id),
    { message: 'Exactly one of `prompt` or `prompt_id` must be provided.' },
  )
export type ScheduleCreatePayload = z.infer<typeof ScheduleCreatePayloadSchema>

export const BUILDER_KIND_COMMAND_CREATE = 'builder.workspace.command.create' as const

export const CommandCreatePayloadSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .describe('Command name without leading slash, e.g. "summarize". Shown as `/<name>`.'),
    type: z
      .enum(['plain', 'struct'])
      .describe(
        '"plain" inlines the prompt text verbatim into the user message; "struct" wraps it as a structured slash-command invocation.',
      ),
    prompt: z
      .string()
      .optional()
      .describe('Raw prompt text. Provide this OR prompt_id, not both.'),
    prompt_id: z
      .string()
      .optional()
      .describe(
        'Reference an existing prompt from the user library by id. Provide this OR prompt, not both.',
      ),
  })
  .refine(
    (v: { prompt?: string; prompt_id?: string }) => Boolean(v.prompt) !== Boolean(v.prompt_id),
    { message: 'Exactly one of `prompt` or `prompt_id` must be provided.' },
  )
export type CommandCreatePayload = z.infer<typeof CommandCreatePayloadSchema>

const promptXorRefine = <T extends { prompt?: string; prompt_id?: string }>(v: T) =>
  !(v.prompt !== undefined && v.prompt_id !== undefined)

export const BUILDER_KIND_SCHEDULE_UPDATE = 'builder.workspace.schedule.update' as const

export const ScheduleUpdatePayloadSchema = z
  .object({
    id: z.string().describe('Schedule id, e.g. from `list_schedules`.'),
    name: z.string().min(1).optional(),
    cron: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Standard cron expression. Setting this switches a one-time schedule to recurring; cannot be combined with `run_at` in the same update.',
      ),
    run_at: z
      .string()
      .datetime()
      .optional()
      .describe(
        'ISO 8601 timestamp for a one-time schedule. Setting this switches a recurring schedule to one-time; cannot be combined with `cron` in the same update. Must be in the future.',
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone, e.g. "Asia/Singapore". If the user did not specify one for an update, ask them; do not assume the existing value still matches their intent when they changed the cron.',
      ),
    prompt: z
      .string()
      .optional()
      .describe('Replace the inline prompt text. Provide this OR prompt_id, not both.'),
    prompt_id: z
      .string()
      .optional()
      .describe(
        'Replace the prompt reference. Provide this OR prompt, not both. Use empty string to clear.',
      ),
    enabled: z.boolean().optional().describe('Pause or resume the schedule.'),
  })
  .refine((v) => !(v.cron !== undefined && v.run_at !== undefined), {
    message: 'Provide at most one of `cron` or `run_at`.',
  })
  .refine(promptXorRefine, { message: 'Provide at most one of `prompt` or `prompt_id`.' })
export type ScheduleUpdatePayload = z.infer<typeof ScheduleUpdatePayloadSchema>

export const BUILDER_KIND_SCHEDULE_DELETE = 'builder.workspace.schedule.delete' as const

export const ScheduleDeletePayloadSchema = z.object({
  id: z.string().describe('Schedule id, e.g. from `list_schedules`.'),
})
export type ScheduleDeletePayload = z.infer<typeof ScheduleDeletePayloadSchema>

export const BUILDER_KIND_COMMAND_UPDATE = 'builder.workspace.command.update' as const

export const CommandUpdatePayloadSchema = z
  .object({
    id: z.string().describe('Command id, e.g. from `list_commands`.'),
    name: z.string().min(1).optional(),
    type: z.enum(['plain', 'struct']).optional(),
    prompt: z.string().optional(),
    prompt_id: z.string().optional(),
  })
  .refine(promptXorRefine, { message: 'Provide at most one of `prompt` or `prompt_id`.' })
export type CommandUpdatePayload = z.infer<typeof CommandUpdatePayloadSchema>

export const BUILDER_KIND_COMMAND_DELETE = 'builder.workspace.command.delete' as const

export const CommandDeletePayloadSchema = z.object({
  id: z.string().describe('Command id, e.g. from `list_commands`.'),
})
export type CommandDeletePayload = z.infer<typeof CommandDeletePayloadSchema>

export const BUILDER_KIND_COMMAND_SET_DISABLED = 'builder.workspace.command.set_disabled' as const

export const CommandSetDisabledPayloadSchema = z.object({
  name: z.string().min(1).describe('Name of the template-provided command to toggle.'),
  disabled: z.boolean().describe('true to disable for this workspace, false to re-enable.'),
})
export type CommandSetDisabledPayload = z.infer<typeof CommandSetDisabledPayloadSchema>

export const BUILDER_KIND_SKILL_ENABLE = 'builder.workspace.skill.enable' as const

export const SkillEnablePayloadSchema = z.object({
  names: z
    .array(z.string().min(1))
    .min(1)
    .describe('Skill names to attach to this workspace (e.g. from `list_skills`).'),
})
export type SkillEnablePayload = z.infer<typeof SkillEnablePayloadSchema>

export const BUILDER_KIND_SKILL_DISABLE = 'builder.workspace.skill.disable' as const

export const SkillDisablePayloadSchema = z.object({
  names: z
    .array(z.string().min(1))
    .min(1)
    .describe('Skill names to detach from this workspace.'),
})
export type SkillDisablePayload = z.infer<typeof SkillDisablePayloadSchema>

export const BUILDER_KIND_CONFIG_UPDATE = 'builder.workspace.config.update' as const

export const ConfigUpdatePayloadSchema = z
  .object({
    name: z.string().min(1).optional().describe('Rename the workspace.'),
    slug: z
      .string()
      .optional()
      .describe(
        'URL slug. Lowercase alphanumeric with optional hyphens. Use "" to clear (the workspace falls back to id-based URLs).',
      ),
    visibility: z
      .enum(['private', 'user', 'public'])
      .optional()
      .describe(
        'Workspace visibility. `private` (only the owner, not even callable as a sub-agent), `user` (callable by the owner\'s own agents via @agent/<slug>), `public` (callable by anyone via @agent/<owner>/<slug>).',
      ),
    agent_type: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Agent runtime to use, e.g. "claude-code" / "codex" / "goose". Changing this while the workspace is running triggers a container rebuild.',
      ),
    provider_id: z
      .string()
      .optional()
      .describe(
        'Model provider id, e.g. from `list_providers`. Use "" to clear and fall back to the default provider.',
      ),
    model: z.string().min(1).optional().describe('Primary model name.'),
    small_model: z
      .string()
      .optional()
      .describe('Smaller/faster model for cheap turns. Use "" to clear.'),
  })
  .refine(
    (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined),
    { message: 'At least one field must be provided.' },
  )
export type ConfigUpdatePayload = z.infer<typeof ConfigUpdatePayloadSchema>

export const BUILDER_KIND_PROMPT_SET = 'builder.workspace.prompt.set' as const

export const PromptSetPayloadSchema = z
  .object({
    system_prompt: z
      .string()
      .optional()
      .describe('Inline system prompt text. Use "" with no prompt_id to clear entirely.'),
    prompt_id: z
      .string()
      .optional()
      .describe(
        'Library prompt id, e.g. from `list_prompts`. Use "" to clear the library reference and fall back to inline `system_prompt`.',
      ),
  })
  .refine(
    (v: { system_prompt?: string; prompt_id?: string }) =>
      v.system_prompt !== undefined || v.prompt_id !== undefined,
    { message: 'Provide system_prompt and/or prompt_id.' },
  )
  .refine(
    (v: { system_prompt?: string; prompt_id?: string }) =>
      !(
        v.system_prompt !== undefined &&
        v.system_prompt !== '' &&
        v.prompt_id !== undefined &&
        v.prompt_id !== ''
      ),
    {
      message:
        'Only one source may be non-empty at a time: pass `prompt_id` to switch to a library prompt, or `system_prompt` to write inline text.',
    },
  )
export type PromptSetPayload = z.infer<typeof PromptSetPayloadSchema>

// ── global cap: prompt library ─────────────────────────────────────────────
// Prompts are user-scoped resources, so these actions live on the `global`
// cap. Tool names drop the `workspace_` prefix (see `defineBuilderAction`'s
// `scope` field) — `prompt_create_propose`, etc.
//
// Visibility v1 is restricted to `private | public`; `team` shares need a
// team_id selection and are deferred to a separate action.

const PromptLibraryVisibilitySchema = z.enum(['private', 'public'])

export const BUILDER_KIND_PROMPT_LIBRARY_CREATE = 'builder.global.prompt.create' as const

export const PromptLibraryCreatePayloadSchema = z.object({
  name: z.string().min(1).describe('Prompt display name.'),
  content: z.string().min(1).describe('Prompt content (the full text).'),
  visibility: PromptLibraryVisibilitySchema
    .optional()
    .describe('Defaults to `private`. `public` broadcasts the prompt to all users.'),
})
export type PromptLibraryCreatePayload = z.infer<typeof PromptLibraryCreatePayloadSchema>

export const BUILDER_KIND_PROMPT_LIBRARY_UPDATE = 'builder.global.prompt.update' as const

export const PromptLibraryUpdatePayloadSchema = z
  .object({
    id: z.string().describe('Prompt id, e.g. from `list_prompts`.'),
    name: z.string().min(1).optional(),
    content: z
      .string()
      .min(1)
      .optional()
      .describe('Replacement content. Bumps the prompt version when actually different.'),
    visibility: PromptLibraryVisibilitySchema.optional(),
  })
  .refine(
    (v: { name?: string; content?: string; visibility?: 'private' | 'public' }) =>
      v.name !== undefined || v.content !== undefined || v.visibility !== undefined,
    { message: 'At least one of name / content / visibility must be provided.' },
  )
export type PromptLibraryUpdatePayload = z.infer<typeof PromptLibraryUpdatePayloadSchema>

export const BUILDER_KIND_PROMPT_LIBRARY_DELETE = 'builder.global.prompt.delete' as const

export const PromptLibraryDeletePayloadSchema = z.object({
  id: z.string().describe('Prompt id, e.g. from `list_prompts`.'),
})
export type PromptLibraryDeletePayload = z.infer<typeof PromptLibraryDeletePayloadSchema>
