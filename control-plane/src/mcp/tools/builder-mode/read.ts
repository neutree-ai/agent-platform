import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ResolvedWorkspaceCommand, listWorkspaceCommands } from '../../../services/db/commands'
import {
  type ProviderWithAccess,
  listVisibleToUser as listProvidersVisibleToUser,
} from '../../../services/db/model-providers'
import { pool } from '../../../services/db/pool'
import {
  type PromptWithAccess,
  getPromptForUser,
  listVisibleToUser as listPromptsVisibleToUser,
} from '../../../services/db/prompts'
import { listSchedulesByWorkspace } from '../../../services/db/schedules'
import { createSessionExportToken } from '../../../services/db/session-export-tokens'
import type { Schedule } from '../../../services/db/types'
import { getWorkspace, getWorkspaceConfig } from '../../../services/db/workspaces'
import type { SkillWithAccess } from '../../../services/skill-repository'
import { skillRepo } from '../../../services/skills-composition'
import { textResult } from '../shared'

/**
 * Builder Mode common read tools — available whenever any builder cap is on.
 * Pure reads: no agent_request, no mutation, plain text output so the agent
 * doesn't pay token cost for JSON structural delimiters.
 *
 * Convention:
 *  - list_*  → one record per line, `<id-or-name> | "<title>" | <meta…>`,
 *              optionally followed by a one-line excerpt indented two spaces.
 *  - get_*   → same header line, blank line, raw body.
 */
export function registerBuilderReadTools(server: McpServer, workspaceId: string): void {
  registerListPrompts(server, workspaceId)
  registerGetPrompt(server, workspaceId)
  registerListSchedules(server, workspaceId)
  registerListCommands(server, workspaceId)
  registerGetCommand(server, workspaceId)
  registerListSkills(server, workspaceId)
  registerGetSkill(server, workspaceId)
  registerListProviders(server, workspaceId)
  registerGetWorkspaceConfig(server, workspaceId)
  registerListSessions(server, workspaceId)
  registerGetSessionExportUrls(server, workspaceId)
}

// ── prompts ────────────────────────────────────────────────────────────────

function registerListPrompts(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_prompts',
    {
      title: 'List prompts in the user library',
      description:
        'List prompts the current user can see (own, team-shared, public). Output is one prompt per line: `<id> | "<name>" | <visibility>[ | @<owner>]` followed by an indented one-line excerpt. Use this before referencing a prompt by id in a propose tool.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on prompt name and content.'),
        visibility: z
          .enum(['private', 'team', 'public'])
          .optional()
          .describe('Restrict to a single visibility scope.'),
      }),
    },
    async ({ search, visibility }) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        const all = await listPromptsVisibleToUser(workspace.user_id)
        const filtered = all.filter((p) => {
          if (visibility && p.visibility !== visibility) return false
          if (search) {
            const needle = search.toLowerCase()
            if (!p.name.toLowerCase().includes(needle) && !p.content.toLowerCase().includes(needle))
              return false
          }
          return true
        })

        if (filtered.length === 0) return textResult('No prompts match.')
        return textResult(filtered.map(formatPromptListLine).join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

function registerGetPrompt(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'get_prompt',
    {
      title: 'Get a prompt by id',
      description:
        'Fetch the full content of a single prompt the current user can see. Output is one header line (same format as list_prompts), a blank line, then the raw content.',
      inputSchema: z.object({
        id: z.string().describe('Prompt id, e.g. from `list_prompts`.'),
      }),
    },
    async ({ id }) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        const prompt = await getPromptForUser(id, workspace.user_id)
        if (!prompt) return textResult('Error: prompt not found or not accessible')

        return textResult(`${formatPromptHeader(prompt)}\n\n${prompt.content}`)
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── schedules (workspace-scoped) ───────────────────────────────────────────

function registerListSchedules(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_schedules',
    {
      title: 'List schedules in this workspace',
      description:
        'List cron schedules attached to the current workspace. Use this before proposing a new one to avoid duplicates. Output: `<id> | "<name>" | <cron> <timezone>[ | template][ | disabled]` plus an indented prompt excerpt. Template-provided schedules are read-only except enable/disable — fork to customize, do not edit/delete them.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on schedule name and prompt content.'),
      }),
    },
    async ({ search }) => {
      try {
        const all = await listSchedulesByWorkspace(workspaceId)
        const filtered = all.filter((s) => {
          if (!search) return true
          const needle = search.toLowerCase()
          const promptHay = `${s.prompt ?? ''}${s.prompt_content ?? ''}`.toLowerCase()
          return s.name.toLowerCase().includes(needle) || promptHay.includes(needle)
        })

        if (filtered.length === 0) return textResult('No schedules match.')
        return textResult(filtered.map(formatScheduleListLine).join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── workspace commands (slash commands) ────────────────────────────────────

function registerListCommands(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_commands',
    {
      title: 'List slash commands in this workspace',
      description:
        'List slash commands the current workspace has registered. Output: `<id> | /<name> | <type>` (plus `| library: <prompt_id>` when the command references a library prompt, `| template` when it comes from the workspace template, `| disabled` when toggled off) followed by an indented one-line content excerpt. Use command_set_disabled to toggle any command (local or template) on/off without deleting it. Template commands are read-only otherwise: fork them into a local command to customize — do not try to edit/delete them.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on command name and content.'),
      }),
    },
    async ({ search }) => {
      try {
        const all = await listWorkspaceCommands(workspaceId)
        const filtered = all.filter((c) => {
          if (!search) return true
          const needle = search.toLowerCase()
          const body = `${c.content ?? ''}${c.prompt_content ?? ''}`.toLowerCase()
          return c.name.toLowerCase().includes(needle) || body.includes(needle)
        })

        if (filtered.length === 0) return textResult('No commands match.')
        return textResult(filtered.map(formatCommandListLine).join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

function registerGetCommand(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'get_command',
    {
      title: 'Get a workspace command by id',
      description:
        'Fetch the full content of a single slash command. Output is one header line (same format as list_commands, including the `library: <prompt_id>` marker when applicable), a blank line, then the raw content (or referenced prompt content). If the header carries `library:`, the body is from the library prompt — preserve `prompt_id` on update to keep the reference.',
      inputSchema: z.object({
        id: z.string().describe('Command id, e.g. from `list_commands`.'),
      }),
    },
    async ({ id }) => {
      try {
        const all = await listWorkspaceCommands(workspaceId)
        const cmd = all.find((c) => c.id === id)
        if (!cmd) return textResult('Error: command not found in this workspace')

        const body = cmd.content || cmd.prompt_content || '(empty)'
        return textResult(`${formatCommandHeader(cmd)}\n\n${body}`)
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── skills ─────────────────────────────────────────────────────────────────

function registerListSkills(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_skills',
    {
      title: 'List skills available to the user',
      description:
        'List skills the user can see (own, team-shared, public). Each line marks whether the skill is currently attached to this workspace. Output: `<name> | <visibility>[ | @<owner>][ | attached]` plus an indented description excerpt.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on skill name and description.'),
        visibility: z
          .enum(['private', 'team', 'public'])
          .optional()
          .describe('Restrict to a single visibility scope.'),
      }),
    },
    async ({ search, visibility }) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        const [all, attachedIds] = await Promise.all([
          skillRepo.listVisibleToUser(workspace.user_id),
          skillRepo.getWorkspaceSkillIds(workspaceId),
        ])
        // p3: workspace_skills FKs by id (names aren't globally unique). Match
        // attached state by id rather than by name.
        const attached = new Set(attachedIds)

        const filtered = all.filter((s) => {
          if (visibility && s.visibility !== visibility) return false
          if (search) {
            const needle = search.toLowerCase()
            if (
              !s.name.toLowerCase().includes(needle) &&
              !(s.description ?? '').toLowerCase().includes(needle)
            )
              return false
          }
          return true
        })

        if (filtered.length === 0) return textResult('No skills match.')
        return textResult(
          filtered.map((s) => formatSkillListLine(s, attached.has(s.id))).join('\n'),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

function registerGetSkill(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'get_skill',
    {
      title: 'Get a skill by name',
      description:
        'Fetch the description of a single skill the current user can see. Output is one header line plus the full description body.',
      inputSchema: z.object({
        name: z.string().describe('Skill name, e.g. from `list_skills`.'),
      }),
    },
    async ({ name }) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        // p3: getSkillForUser expects the canonical UUID. The builder agent
        // sees names from `list_skills`; resolve to id via the workspace owner
        // first.
        const meta = await skillRepo.getSkillByNameForUser(name, workspace.user_id)
        if (!meta) return textResult('Error: skill not found or not accessible')
        const skill = await skillRepo.getSkillForUser(meta.id, workspace.user_id)
        if (!skill) return textResult('Error: skill not found or not accessible')

        const attached = (await skillRepo.getWorkspaceSkillIds(workspaceId)).includes(meta.id)
        return textResult(
          `${formatSkillHeader(skill, attached)}\n\n${skill.description ?? '(no description)'}`,
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── providers ──────────────────────────────────────────────────────────────

function registerListProviders(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_providers',
    {
      title: 'List model providers',
      description:
        'List model providers the current user can see. Output: `<id> | "<name>" | <provider_type> | <visibility>[ | @<owner>]` plus an indented description excerpt.',
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on provider name and description.'),
        visibility: z
          .enum(['private', 'team', 'public'])
          .optional()
          .describe('Restrict to a single visibility scope.'),
      }),
    },
    async ({ search, visibility }) => {
      try {
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        const all = await listProvidersVisibleToUser(workspace.user_id)
        const filtered = all.filter((p) => {
          if (visibility && p.visibility !== visibility) return false
          if (search) {
            const needle = search.toLowerCase()
            if (
              !p.name.toLowerCase().includes(needle) &&
              !(p.description ?? '').toLowerCase().includes(needle)
            )
              return false
          }
          return true
        })

        if (filtered.length === 0) return textResult('No providers match.')
        return textResult(filtered.map(formatProviderListLine).join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── workspace config ───────────────────────────────────────────────────────

function registerGetWorkspaceConfig(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'get_workspace_config',
    {
      title: 'Get the current workspace agent config',
      description:
        "Show the current workspace's identity (name, slug, visibility) and agent configuration (agent_type, model, provider, prompt source, attached skills, mcp/settings presence). Use this before proposing changes to know what's already in place.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const [config, attachedSkillIds, workspace] = await Promise.all([
          getWorkspaceConfig(workspaceId),
          skillRepo.getWorkspaceSkillIds(workspaceId),
          getWorkspace(workspaceId),
        ])
        // Resolve attached ids → display names (best-effort) for the text
        // report. Missing rows degrade to the bare id.
        const attachedSkills = await Promise.all(
          attachedSkillIds.map(async (sid) => {
            const meta = await skillRepo.getSkillMeta(sid)
            return meta?.name ?? sid
          }),
        )
        if (!config || !workspace) return textResult('Error: workspace config not found')

        const lines: string[] = []
        lines.push(`name: "${workspace.name}"`)
        lines.push(`slug: ${workspace.slug || '(none)'}`)
        lines.push(`visibility: ${workspace.visibility}`)
        lines.push(`agent: ${config.agent_type}`)
        const modelLine = config.small_model
          ? `model: ${config.model} (small: ${config.small_model})`
          : `model: ${config.model}`
        lines.push(modelLine)
        lines.push(
          `provider: ${config.provider_type}${config.provider_id ? ` | id=${config.provider_id}` : ''}`,
        )

        if (config.prompt_id) {
          const promptName = config.prompt_name ? ` "${config.prompt_name}"` : ''
          lines.push(`prompt: library ${config.prompt_id}${promptName}`)
        } else if (config.system_prompt && config.system_prompt.trim().length > 0) {
          lines.push(`prompt: inline (${formatExcerpt(config.system_prompt)})`)
        } else {
          lines.push('prompt: (none)')
        }

        if (config.template_id) {
          lines.push(
            `template: ${config.template_name ?? config.template_id} v${config.template_version}`,
          )
        }

        lines.push(`skills: ${attachedSkills.length > 0 ? attachedSkills.join(', ') : '(none)'}`)
        lines.push(`mcp_config: ${describeJsonBlob(config.mcp_config)}`)
        lines.push(`agent_settings: ${describeJsonBlob(config.agent_settings)}`)

        return textResult(lines.join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

// ── sessions ───────────────────────────────────────────────────────────────

const SESSION_LIST_DEFAULT_LIMIT = 20
const SESSION_LIST_MAX_LIMIT = 100
const SESSION_EXPORT_DEFAULT_TTL = 600
const SESSION_EXPORT_MAX_TTL = 3600
const SESSION_EXPORT_MAX_BATCH = 50

function registerListSessions(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'list_sessions',
    {
      title: 'List past chat sessions in this workspace',
      description: `List the workspace's past chat sessions, most recently active first. Lightweight metadata only — use \`get_session_export_urls\` to fetch full transcripts.

Output: one session per line, \`<id> | "<name>" | <msg_count>m | <chat_status> | <source> | <last_active_at>\` followed by an indented one-line preview of the first user message.

Pagination: pass \`cursor\` from a previous call's last line to continue. Cursor is opaque ("<last_active_at>|<id>").

Typical Builder Mode flow: \`list_sessions\` → pick a few interesting ids → \`get_session_export_urls\` with those ids → fetch each JSONL via your file/web tools and reason over the contents.`,
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(SESSION_LIST_MAX_LIMIT)
          .optional()
          .describe(
            `Max rows to return. Default ${SESSION_LIST_DEFAULT_LIMIT}, max ${SESSION_LIST_MAX_LIMIT}.`,
          ),
        cursor: z
          .string()
          .optional()
          .describe(
            'Opaque continuation cursor from a prior call. Pass to fetch the next page; omit for the first page.',
          ),
        search: z
          .string()
          .optional()
          .describe(
            'Case-insensitive substring filter on session name and the first user message preview.',
          ),
      }),
    },
    async ({ limit, cursor, search }) => {
      try {
        const lim = limit ?? SESSION_LIST_DEFAULT_LIMIT
        const params: unknown[] = [workspaceId]
        let cursorClause = ''
        if (cursor) {
          const decoded = decodeSessionCursor(cursor)
          if (!decoded) return textResult('Error: invalid cursor')
          params.push(decoded.lastActiveAt, decoded.id)
          // Keyset: strictly older than the cursor row, ties broken by id desc.
          cursorClause = `AND (s.last_active_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length}::text)`
        }
        params.push(lim)
        const { rows } = await pool.query(
          `SELECT s.id, s.name, s.chat_status, s.source, s.created_at, s.last_active_at,
                  COALESCE(mc.cnt, 0)::int AS message_count,
                  COALESCE(fm.content, '') AS preview
             FROM sessions s
             LEFT JOIN LATERAL (
               SELECT COUNT(*)::int AS cnt FROM messages m WHERE m.session_id = s.id
             ) mc ON true
             LEFT JOIN LATERAL (
               SELECT content FROM messages m
              WHERE m.session_id = s.id AND m.role = 'user'
              ORDER BY m.created_at ASC LIMIT 1
             ) fm ON true
            WHERE s.workspace_id = $1 AND s.status = 'active' ${cursorClause}
            ORDER BY s.last_active_at DESC NULLS LAST, s.id DESC
            LIMIT $${params.length}`,
          params,
        )
        const items = rows as Array<{
          id: string
          name: string
          chat_status: string
          source: string
          created_at: Date | string
          last_active_at: Date | string | null
          message_count: number
          preview: string
        }>
        const filtered = search
          ? items.filter((s) => {
              const needle = search.toLowerCase()
              return (
                (s.name ?? '').toLowerCase().includes(needle) ||
                (s.preview ?? '').toLowerCase().includes(needle)
              )
            })
          : items
        if (filtered.length === 0) return textResult('No sessions match.')

        const lines = filtered.map(formatSessionListLine)
        // Append a cursor footer only if we likely have more pages (the page
        // came back full pre-filter — search filtering is post-query and
        // can't extend pagination).
        if (items.length === lim) {
          const last = items[items.length - 1]
          const next = encodeSessionCursor(last.last_active_at, last.id)
          lines.push(`\nnext_cursor: ${next}`)
        }
        return textResult(lines.join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

function registerGetSessionExportUrls(server: McpServer, workspaceId: string): void {
  server.registerTool(
    'get_session_export_urls',
    {
      title: 'Mint download URLs for one or more session transcripts',
      description: `Mint short-lived public HTTPS URLs that return each session's full transcript as JSONL. **Batch tool** — pass multiple \`session_ids\` in one call to avoid per-session round trips.

**Output format** of the downloaded body: newline-delimited JSON. Each line is either a message or an event interleaved by timestamp:
  - \`{"type":"message", "id", "role", "content", "blocks"?, "created_at"}\` — user/assistant text
  - \`{"type":"event", "id", "message_id", "kind", "call_id", "payload", "created_at"}\` — text / tool_call / tool_result granular events

**How to consume**: do NOT try to read the URL through MCP — fetch it with your own tools (Read for the local path if you save it, or your HTTP/fetch capability for the URL), then parse line by line. Each session can be large; expect MB-scale bodies.

**Security model**: the URL itself is the bearer token. Anyone with the URL can read the session until \`expires_at\`. Keep TTL as short as plausibly covers your analysis.

Returns one line per requested session: \`<session_id> | <url> | expires <expires_at>\`, or \`<session_id> | error: <message>\` for sessions that don't belong to this workspace or weren't found.`,
      inputSchema: z.object({
        session_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(SESSION_EXPORT_MAX_BATCH)
          .describe(
            `Session ids to export, from \`list_sessions\`. Up to ${SESSION_EXPORT_MAX_BATCH} per call — batch related sessions together rather than calling once per id.`,
          ),
        ttl_seconds: z
          .number()
          .int()
          .min(60)
          .max(SESSION_EXPORT_MAX_TTL)
          .optional()
          .describe(
            `URL lifetime in seconds. Default ${SESSION_EXPORT_DEFAULT_TTL} (10 min), max ${SESSION_EXPORT_MAX_TTL} (1 hour). Prefer the shortest TTL that covers the analysis turn; minting a fresh URL later is cheap.`,
          ),
      }),
    },
    async ({ session_ids, ttl_seconds }) => {
      if (!FILES_PUBLIC_URL) {
        return textResult('Error: FILES_PUBLIC_URL env var is not set on the control plane')
      }
      try {
        const ttl = ttl_seconds ?? SESSION_EXPORT_DEFAULT_TTL
        // Validate session ownership in one query, then per-id error or mint.
        const { rows } = await pool.query(
          'SELECT id FROM sessions WHERE workspace_id = $1 AND id = ANY($2::text[])',
          [workspaceId, session_ids],
        )
        const valid = new Set((rows as { id: string }[]).map((r) => r.id))

        const lines: string[] = []
        for (const sid of session_ids) {
          if (!valid.has(sid)) {
            lines.push(`${sid} | error: session not found in this workspace`)
            continue
          }
          try {
            const record = await createSessionExportToken(workspaceId, sid, ttl)
            const url = `${FILES_PUBLIC_URL}/session/${record.token}`
            lines.push(`${sid} | ${url} | expires ${record.expires_at.toISOString()}`)
          } catch (e: any) {
            lines.push(`${sid} | error: ${e.message}`)
          }
        }
        return textResult(lines.join('\n'))
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}

function formatSessionListLine(s: {
  id: string
  name: string
  chat_status: string
  source: string
  last_active_at: Date | string | null
  message_count: number
  preview: string
}): string {
  const lastActive = s.last_active_at
    ? s.last_active_at instanceof Date
      ? s.last_active_at.toISOString()
      : String(s.last_active_at)
    : '-'
  const name = s.name?.trim() ? s.name : '(unnamed)'
  const head = `${s.id} | "${name}" | ${s.message_count}m | ${s.chat_status} | ${s.source} | ${lastActive}`
  return `${head}\n  ${formatExcerpt(s.preview || '')}`
}

function encodeSessionCursor(lastActiveAt: Date | string | null, id: string): string {
  const ts = lastActiveAt
    ? lastActiveAt instanceof Date
      ? lastActiveAt.toISOString()
      : String(lastActiveAt)
    : ''
  return Buffer.from(`${ts}|${id}`, 'utf-8').toString('base64url')
}

function decodeSessionCursor(cursor: string): { lastActiveAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf-8')
    const sep = raw.indexOf('|')
    if (sep === -1) return null
    const lastActiveAt = raw.slice(0, sep)
    const id = raw.slice(sep + 1)
    if (!lastActiveAt || !id) return null
    return { lastActiveAt, id }
  } catch {
    return null
  }
}

const FILES_PUBLIC_URL = process.env.FILES_PUBLIC_URL || ''

// ── formatting helpers ─────────────────────────────────────────────────────

function formatPromptHeader(p: PromptWithAccess): string {
  const parts = [p.id, `"${p.name}"`, formatVisibilityWithTeams(p.visibility, p.shared_via_teams)]
  if (!p.is_owner) parts.push(`@${p.owner_name}`)
  return parts.join(' | ')
}

function formatPromptListLine(p: PromptWithAccess): string {
  return `${formatPromptHeader(p)}\n  ${formatExcerpt(p.content)}`
}

function formatScheduleListLine(s: Schedule): string {
  const parts = [s.id, `"${s.name}"`, `${s.cron} ${s.timezone}`]
  if (s.origin === 'template') parts.push('template')
  if (!s.enabled) parts.push('disabled')
  const promptSrc = s.prompt_id
    ? `(library prompt: ${s.prompt_id})`
    : formatExcerpt(s.prompt || s.prompt_content || '')
  return `${parts.join(' | ')}\n  ${promptSrc}`
}

function formatCommandHeader(c: ResolvedWorkspaceCommand): string {
  const parts = [c.id, `/${c.name}`, c.type]
  if (c.prompt_id) parts.push(`library: ${c.prompt_id}`)
  if (c.source === 'template') parts.push('template')
  if (c.disabled) parts.push('disabled')
  return parts.join(' | ')
}

function formatCommandListLine(c: ResolvedWorkspaceCommand): string {
  const body = c.content || c.prompt_content || ''
  return `${formatCommandHeader(c)}\n  ${formatExcerpt(body)}`
}

function formatSkillHeader(s: SkillWithAccess, attached: boolean): string {
  const parts = [s.name, formatVisibilityWithTeams(s.visibility, s.shared_via_teams)]
  if (!s.is_owner && s.owner_name) parts.push(`@${s.owner_name}`)
  if (attached) parts.push('attached')
  return parts.join(' | ')
}

function formatSkillListLine(s: SkillWithAccess, attached: boolean): string {
  return `${formatSkillHeader(s, attached)}\n  ${formatExcerpt(s.description ?? '')}`
}

function formatProviderListLine(p: ProviderWithAccess): string {
  const parts = [
    p.id,
    `"${p.name}"`,
    p.provider_type,
    formatVisibilityWithTeams(p.visibility, p.shared_via_teams),
  ]
  if (!p.is_owner && p.owner_name) parts.push(`@${p.owner_name}`)
  return `${parts.join(' | ')}\n  ${formatExcerpt(p.description ?? '')}`
}

function formatVisibilityWithTeams(
  visibility: string,
  teams: { name: string }[] | undefined,
): string {
  if (visibility === 'team') {
    const names = (teams ?? []).map((t) => t.name).join(',')
    return names ? `team:${names}` : 'team'
  }
  return visibility
}

function formatExcerpt(content: string, max = 60): string {
  const firstLine =
    content
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  if (firstLine.length === 0) return '(empty)'
  if (firstLine.length <= max) return firstLine
  return `${firstLine.slice(0, max - 1)}…`
}

function describeJsonBlob(raw: string | null | undefined): string {
  if (!raw) return '(empty)'
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '{}' || trimmed === 'null') return '(empty)'
  return `${trimmed.length} chars`
}
