import { z } from '@hono/zod-openapi'

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error')

const EndpointsSchema = z
  .object({
    cdp: z.string().openapi({ example: 'https://browser.example.com/cdp/abc123' }),
    live_view: z.string().openapi({ example: 'https://browser.example.com/live/abc123/' }),
  })
  .openapi('BrowserEndpoints')

export const BrowserSchema = z
  .object({
    id: z.string().openapi({ example: 'brw-abc123' }),
    status: z.string().openapi({ example: 'running' }),
    expires_at: z.union([z.string(), z.date()]).nullable(),
    created_at: z.union([z.string(), z.date()]),
    endpoints: EndpointsSchema.optional(),
  })
  .openapi('Browser')

export const BrowserListResponseSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        expires_at: z.union([z.string(), z.date()]).nullable(),
        created_at: z.union([z.string(), z.date()]),
      }),
    ),
  })
  .openapi('BrowserListResponse')

export const CreateBrowserBodySchema = z
  .object({
    timeout_seconds: z.number().int().min(60).max(86400).optional().openapi({ example: 3600 }),
    resource: z.record(z.string(), z.string()).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .openapi('CreateBrowserBody')

export const RenewBrowserBodySchema = z
  .object({
    timeout_seconds: z.number().int().positive().optional().openapi({ example: 3600 }),
  })
  .openapi('RenewBrowserBody')

export const RenewBrowserResponseSchema = z
  .object({
    expires_at: z.union([z.string(), z.date()]),
  })
  .openapi('RenewBrowserResponse')

export const DeleteBrowserResponseSchema = z
  .object({ success: z.literal(true) })
  .openapi('DeleteBrowserResponse')

export const UserMeSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
  })
  .openapi('UserMe')

export const LogoutResponseSchema = z.object({ success: z.literal(true) }).openapi('LogoutResponse')

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
  .openapi('BrowserFileInfo')

export const ListFilesResponseSchema = z
  .object({
    files: z.array(FileInfoSchema),
  })
  .openapi('BrowserListFilesResponse')
