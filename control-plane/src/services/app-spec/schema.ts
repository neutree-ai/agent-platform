// The application spec document (PUT /apps/v1/spec), apiVersion nap.app/v1.
//
// Rules that keep later versions compatible with documents written today:
//   - unknown fields are refused, so a field added later can't have meant
//     something else before;
//   - collections are maps keyed by name, except pure reference lists;
//   - content is referenced by name, never inlined (a prompt is `name` or
//     `name@version`).

import { Cron } from 'croner'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const API_VERSION = 'nap.app/v1'

// Agent names double as workspace slugs, so they follow the slug rules.
const Name = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'must be lowercase letters, digits and hyphens')

/** A provider, skill or environment: by name. */
const Ref = z.string().trim().min(1).max(200)

/** A prompt: by name, optionally pinned to a version (`name@3`). */
const VersionedRef = z
  .string()
  .trim()
  .regex(/^[^@\s]+(@[1-9][0-9]*)?$/, 'must be <name> or <name>@<version>')

const Runtime = z.strictObject({
  agent_type: z.string().min(1),
  environment: Ref.optional(),
  compute: z
    .strictObject({
      cpu_request: z.string(),
      cpu_limit: z.string(),
      memory_request: z.string(),
      memory_limit: z.string(),
      storage: z.string(),
    })
    .partial()
    .optional(),
  // Present: the agent's workspaces scale between these bounds. Absent: each
  // is a single replica. Only a new workspace takes a change between the two.
  scaling: z
    .strictObject({
      min_replicas: z.number().int().min(0),
      max_replicas: z.number().int().min(1),
      scale_to_zero_idle_seconds: z.number().int().positive().nullable().default(null),
    })
    .refine((v) => v.min_replicas <= v.max_replicas, {
      message: 'min_replicas must be <= max_replicas',
    })
    .optional(),
  max_concurrency: z.number().int().min(1).optional(),
  max_steps: z.number().int().min(1).optional(),
})

const Schedule = z
  .strictObject({
    cron: z.string().min(1),
    timezone: z.string().default('UTC'),
    prompt: z.string().min(1),
    enabled: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    try {
      new Cron(s.cron, { paused: true, timezone: s.timezone })
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: `invalid cron or timezone: ${(e as Error).message}` })
    }
  })

const Agent = z.strictObject({
  runtime: Runtime,
  model: z.strictObject({
    provider: Ref,
    name: z.string().min(1),
    small: z.string().min(1).optional(),
  }),
  prompt: VersionedRef.optional(),
  skills: z.array(Ref).optional(),
  // Each key names one of the spec's mcp_servers.
  mcp: z.record(Name, z.strictObject({})).optional(),
  // The agent runtime's own settings, passed through: an object for JSON
  // runtimes, a string for the ones configured in TOML or YAML.
  settings: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  commands: z.record(Name, z.strictObject({ content: z.string().min(1) })).optional(),
  schedules: z.record(Name, Schedule).optional(),
  // Other agents of the spec this one calls. Each of them is given a slug
  // (its name) and made callable by any of the same user's workspaces: the
  // list says which agents are called, not that only this one may call them.
  calls: z.array(Name).optional(),
})

const McpServer = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).optional(),
  // The application runs this server itself: calls to it carry a statement,
  // signed by the platform, of which user and workspace made them. Its origin
  // can't be claimed by another application.
  identify_caller: z.boolean().default(false),
})

// A folder's name is where it is mounted, /mnt/afs/<name>, and afs takes
// names of at most 48 characters.
const FolderName = Name.max(48, 'must be at most 48 characters')

const FolderPermission = z.enum(['read_write', 'read_only'])

// A folder each user gets: its workspace for `owner` owns it, and its
// workspaces for the member agents mount it too.
const SharedFolder = z.strictObject({
  owner: Name,
  members: z.record(Name, FolderPermission).optional(),
})

const AppSpecSchema = z
  .strictObject({
    apiVersion: z.literal(API_VERSION),
    mcp_servers: z.record(Name, McpServer).optional(),
    agents: z.record(Name, Agent),
    shared_folders: z.record(FolderName, SharedFolder).optional(),
    // Reserved for capabilities layered on top of the agents.
    extensions: z.strictObject({}).optional(),
  })
  .superRefine((spec, ctx) => {
    const servers = spec.mcp_servers ?? {}
    for (const [name, agent] of Object.entries(spec.agents)) {
      for (const server of Object.keys(agent.mcp ?? {})) {
        if (!servers[server]) {
          ctx.addIssue({
            code: 'custom',
            path: ['agents', name, 'mcp', server],
            message: 'not one of mcp_servers',
          })
        }
      }
      for (const callee of agent.calls ?? []) {
        if (callee === name || !spec.agents[callee]) {
          ctx.addIssue({
            code: 'custom',
            path: ['agents', name, 'calls'],
            message: `${callee} is not another agent of the spec`,
          })
        }
      }
    }
    for (const [name, folder] of Object.entries(spec.shared_folders ?? {})) {
      if (!spec.agents[folder.owner]) {
        ctx.addIssue({
          code: 'custom',
          path: ['shared_folders', name, 'owner'],
          message: `${folder.owner} is not an agent of the spec`,
        })
      }
      for (const member of Object.keys(folder.members ?? {})) {
        // The owner always has the folder read-write; listing it again could
        // only contradict that.
        if (member === folder.owner) {
          ctx.addIssue({
            code: 'custom',
            path: ['shared_folders', name, 'members', member],
            message: 'is the owner',
          })
        } else if (!spec.agents[member]) {
          ctx.addIssue({
            code: 'custom',
            path: ['shared_folders', name, 'members', member],
            message: 'not an agent of the spec',
          })
        }
      }
    }
  })

export type AppSpec = z.infer<typeof AppSpecSchema>

export class SpecError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '))
  }
}

export interface ParsedSpec {
  spec: AppSpec
  /** The document as written, for giving back in its own order. */
  document: Record<string, unknown>
}

/** Parse a JSON or YAML body (by content type) into a validated spec. */
export function parseAppSpec(body: string, contentType: string | undefined): ParsedSpec {
  let raw: unknown
  try {
    raw = /yaml/i.test(contentType ?? '') ? parseYaml(body) : JSON.parse(body)
  } catch (e) {
    throw new SpecError([
      `not valid ${/yaml/i.test(contentType ?? '') ? 'YAML' : 'JSON'}: ${(e as Error).message}`,
    ])
  }
  const result = AppSpecSchema.safeParse(raw)
  if (!result.success) {
    throw new SpecError(
      result.error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`),
    )
  }
  return { spec: result.data, document: raw as Record<string, unknown> }
}
