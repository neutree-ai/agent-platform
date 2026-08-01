import { z } from '@hono/zod-openapi'

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error')

export const SandboxInfoSchema = z
  .object({
    id: z.string().openapi({ example: 'sbx-abc123' }),
    image: z.any().openapi({ description: 'Image spec (SDK-defined shape)' }),
    entrypoint: z.array(z.string()),
    metadata: z.record(z.string(), z.string()).optional(),
    status: z.any().openapi({ description: 'SandboxStatus (SDK-defined)' }),
    createdAt: z.union([z.string(), z.date()]),
    expiresAt: z.union([z.string(), z.date()]).nullable(),
  })
  .loose()
  .openapi('SandboxInfo')

export const ListSandboxesResponseSchema = z
  .object({
    sandboxes: z.array(SandboxInfoSchema),
  })
  .loose()
  .openapi('ListSandboxesResponse')

export const CreateSandboxBodySchema = z
  .object({
    image: z.string().openapi({ example: 'ubuntu:22.04' }),
    resource: z.object({ cpu: z.string().optional(), memory: z.string().optional() }).optional(),
    resourceRequests: z
      .object({ cpu: z.string().optional(), memory: z.string().optional() })
      .optional()
      .openapi({
        description:
          'Kubernetes resource requests, set independently of `resource` (limits). Omit to keep requests == limits. Lowering requests puts the sandbox in Burstable QoS so it stops reserving its full limit against node capacity.',
      }),
    timeoutSeconds: z.number().int().positive().optional(),
    entrypoint: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    ownerId: z.string().optional().openapi({
      description:
        'Real owner of this launch. Only honored when the caller authenticates via service key — lets internal services (e.g. browser-service) attribute launches to the end user instead of the synthetic `_service` identity. Ignored for end-user callers.',
    }),
  })
  .openapi('CreateSandboxBody')

export const RenewSandboxBodySchema = z
  .object({
    timeoutSeconds: z.number().int().positive().optional(),
  })
  .openapi('RenewSandboxBody')

export const RenewSandboxResponseSchema = z
  .object({
    expiresAt: z.string().openapi({ example: '2026-04-22T12:00:00Z' }),
  })
  .openapi('RenewSandboxResponse')

export const ExecBodySchema = z
  .object({
    command: z.string().openapi({ example: 'ls -la' }),
    cwd: z.string().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    env: z.record(z.string(), z.string()).optional(),
    background: z.boolean().optional().openapi({
      description:
        'Detach instead of blocking until the command exits. stdout/stderr come back empty; poll the returned commandId via /commands/{commandId} and /commands/{commandId}/logs.',
    }),
  })
  .openapi('ExecBody')

export const ExecResponseSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int().nullable(),
    executionTimeMs: z.number().optional(),
    commandId: z.string().optional(),
    background: z.boolean().optional(),
  })
  .openapi('ExecResponse')

export const CommandStatusResponseSchema = z
  .object({})
  .loose()
  .openapi('CommandStatusResponse', { description: 'Command status (execd-defined shape)' })

export const CommandLogsResponseSchema = z.object({}).loose().openapi('CommandLogsResponse', {
  description:
    'Background command log chunk (execd-defined shape). Carries a tail cursor to resume from.',
})

export const ReadFileResponseSchema = z
  .object({
    content: z.string(),
  })
  .openapi('ReadFileResponse')

const FileInfoSchema = z
  .object({
    path: z.string(),
    size: z.number().int().optional(),
    modifiedAt: z.union([z.string(), z.date()]).optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
    mode: z.number().int().optional(),
    owner: z.string().optional(),
    group: z.string().optional(),
  })
  .loose()
  .openapi('FileInfo')

export const ListFilesResponseSchema = z
  .object({
    files: z.array(FileInfoSchema),
  })
  .openapi('ListFilesResponse')

export const WriteFilesBodySchema = z
  .object({
    files: z.array(
      z.object({
        path: z.string().openapi({ example: '/tmp/foo.txt' }),
        content: z.string(),
      }),
    ),
  })
  .openapi('WriteFilesBody')

export const WriteFilesResponseSchema = z
  .object({
    success: z.literal(true),
    count: z.number().int(),
  })
  .openapi('WriteFilesResponse')

export const DeletePathsBodySchema = z
  .object({
    paths: z
      .array(z.string())
      .min(1)
      .openapi({ example: ['/tmp/foo.txt'] }),
  })
  .openapi('DeletePathsBody')

export const MoveFilesBodySchema = z
  .object({
    entries: z
      .array(z.object({ src: z.string(), dest: z.string() }))
      .min(1)
      .openapi({ example: [{ src: '/tmp/a.txt', dest: '/tmp/b.txt' }] }),
  })
  .openapi('MoveFilesBody')

export const CreateDirectoriesBodySchema = z
  .object({
    entries: z
      .array(
        z.object({
          path: z.string(),
          mode: z
            .number()
            .int()
            .optional()
            .openapi({ description: 'Unix permissions, e.g. 493 (0o755)' }),
        }),
      )
      .min(1)
      .openapi({ example: [{ path: '/tmp/newdir' }] }),
  })
  .openapi('CreateDirectoriesBody')

export const ReplaceContentsBodySchema = z
  .object({
    entries: z
      .array(z.object({ path: z.string(), oldContent: z.string(), newContent: z.string() }))
      .min(1),
  })
  .openapi('ReplaceContentsBody')

export const ReplaceContentsResponseSchema = z
  .object({
    results: z.array(z.object({ path: z.string(), replacedCount: z.number().int() })),
    detailAvailable: z.boolean().openapi({
      description:
        'False when the sandbox runtime is too old to report per-file counts. The replacement still happened — an empty `results` in that case does not mean nothing matched.',
    }),
  })
  .openapi('ReplaceContentsResponse')

export const MutationSuccessResponseSchema = z
  .object({
    success: z.literal(true),
    count: z.number().int(),
  })
  .openapi('MutationSuccessResponse')

export const DeleteSandboxResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .openapi('DeleteSandboxResponse')

export const EndpointResponseSchema = z
  .object({
    url: z.string().openapi({ example: 'https://abc-3000.sandbox.example.com' }),
  })
  .openapi('EndpointResponse')

export const UserMeSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
  })
  .openapi('UserMe')

export const LogoutResponseSchema = z.object({ success: z.literal(true) }).openapi('LogoutResponse')

const LaunchSchema = z
  .object({
    sandboxId: z.string(),
    ownerId: z.string(),
    image: z.string(),
    resource: z.record(z.string(), z.string()),
    entrypoint: z.array(z.string()).nullable(),
    metadata: z.record(z.string(), z.string()),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    renewCount: z.number().int(),
    lastRenewedAt: z.string().nullable(),
  })
  .openapi('Launch')

export const ListLaunchesResponseSchema = z
  .object({
    launches: z.array(LaunchSchema),
  })
  .openapi('ListLaunchesResponse')
