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
  })
  .openapi('ExecBody')

export const ExecResponseSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int().nullable(),
    executionTimeMs: z.number().optional(),
  })
  .openapi('ExecResponse')

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
