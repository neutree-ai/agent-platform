/**
 * Client helpers for the workspace agent file API.
 *
 * Two parallel API surfaces behind matching endpoint suffixes:
 *  - workspace drive  → /api/workspaces/:id/agent/files|dirs|move|dirs/zip
 *  - afs (network drive) → /api/workspaces/:id/agent/afs-files|afs-dirs|afs-move|afs-dirs/zip
 *
 * All paths are workspace-relative; leading slashes are tolerated.
 */

export type DriveKind = 'workspace' | 'afs'

interface DriveEndpoints {
  files: string // e.g. 'agent/files' or 'agent/afs-files'
  dirs: string
  dirsZip: string
  move: string
}

const DRIVES: Record<DriveKind, DriveEndpoints> = {
  workspace: {
    files: 'agent/files',
    dirs: 'agent/dirs',
    dirsZip: 'agent/dirs/zip',
    move: 'agent/move',
  },
  afs: {
    files: 'agent/afs-files',
    dirs: 'agent/afs-dirs',
    dirsZip: 'agent/afs-dirs/zip',
    move: 'agent/afs-move',
  },
}

function stripLeading(path: string): string {
  return path.replace(/^\//, '')
}

export function fileUrl(workspaceId: string, path: string, drive: DriveKind = 'workspace'): string {
  const ep = DRIVES[drive]
  return `/api/workspaces/${workspaceId}/${ep.files}?path=${encodeURIComponent(stripLeading(path))}`
}

export function filePreviewUrl(
  workspaceId: string,
  path: string,
  drive: DriveKind = 'workspace',
): string {
  const ep = DRIVES[drive]
  return `/api/workspaces/${workspaceId}/${ep.files}/preview?path=${encodeURIComponent(stripLeading(path))}`
}

const BINARY_PREVIEW_EXTS = new Set(['pptx', 'ppt', 'docx', 'doc', 'pdf', 'xlsx', 'xls'])

export function isBinaryPreviewFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_PREVIEW_EXTS.has(ext)
}

export function dirListUrl(
  workspaceId: string,
  path: string,
  q?: string,
  drive: DriveKind = 'workspace',
): string {
  const ep = DRIVES[drive]
  const params = new URLSearchParams({ path: stripLeading(path) })
  if (q) params.set('q', q)
  return `/api/workspaces/${workspaceId}/${ep.dirs}?${params}`
}

export function dirZipUrl(
  workspaceId: string,
  path: string,
  drive: DriveKind = 'workspace',
): string {
  const ep = DRIVES[drive]
  return `/api/workspaces/${workspaceId}/${ep.dirsZip}?path=${encodeURIComponent(stripLeading(path))}`
}

export async function mkdir(
  workspaceId: string,
  path: string,
  drive: DriveKind = 'workspace',
): Promise<Response> {
  const ep = DRIVES[drive]
  return fetch(`/api/workspaces/${workspaceId}/${ep.dirs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: stripLeading(path) }),
  })
}

export async function move(
  workspaceId: string,
  src: string,
  dest: string,
  drive: DriveKind = 'workspace',
): Promise<Response> {
  const ep = DRIVES[drive]
  return fetch(`/api/workspaces/${workspaceId}/${ep.move}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: stripLeading(src), dest: stripLeading(dest) }),
  })
}

interface FileExportTokenRecord {
  token: string
  path: string
  url: string
  created_at: string
  /** `null` when the URL is permanent (no expiry). */
  expires_at: string | null
}

export async function createFileExportUrl(
  workspaceId: string,
  path: string,
  options: { ttlSeconds?: number; permanent?: boolean; isDir?: boolean } = {},
): Promise<{ url: string; expires_at: string | null }> {
  const body: Record<string, unknown> = { path: stripLeading(path) }
  if (options.isDir) {
    body.is_dir = true
  }
  if (options.permanent) {
    body.permanent = true
  } else if (options.ttlSeconds != null) {
    body.ttl_seconds = options.ttlSeconds
  }
  const resp = await fetch(`/api/workspaces/${workspaceId}/agent/export-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `export url failed: ${resp.status}`)
  }
  return (await resp.json()) as { url: string; expires_at: string | null }
}

export async function listFileExportTokens(workspaceId: string): Promise<FileExportTokenRecord[]> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/agent/export-tokens`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `list export tokens failed: ${resp.status}`)
  }
  const json = (await resp.json()) as { tokens: FileExportTokenRecord[] }
  return json.tokens
}

export async function revokeFileExportToken(workspaceId: string, token: string): Promise<void> {
  const resp = await fetch(
    `/api/workspaces/${workspaceId}/agent/export-tokens/${encodeURIComponent(token)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok && resp.status !== 204) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `revoke export token failed: ${resp.status}`)
  }
}

export interface AfsShareSummary {
  id: string
  name: string
  owner_workspace_id: string
  afs_dir_id: string
  role: 'owner' | 'member'
  my_permission: 'read_only' | 'read_write'
  created_at: string
}

export async function listAfsShares(workspaceId: string): Promise<AfsShareSummary[]> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/afs/shares`)
  if (!resp.ok) throw new Error(`list afs shares failed: ${resp.status}`)
  const json = (await resp.json()) as { shares: AfsShareSummary[] }
  return json.shares ?? []
}

export async function createAfsShare(workspaceId: string, name: string): Promise<AfsShareSummary> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/afs/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `create share failed: ${resp.status}`)
  }
  return (await resp.json()) as AfsShareSummary
}

export async function deleteAfsShare(workspaceId: string, shareId: string): Promise<void> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/afs/shares/${shareId}`, {
    method: 'DELETE',
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `delete share failed: ${resp.status}`)
  }
}

export interface AfsShareMember {
  workspace_id: string
  permission: 'read_only' | 'read_write'
  mounted_at: string
}

export async function listAfsShareMembers(
  workspaceId: string,
  shareId: string,
): Promise<AfsShareMember[]> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/afs/shares/${shareId}/members`)
  if (!resp.ok) throw new Error(`list members failed: ${resp.status}`)
  const json = (await resp.json()) as { members: AfsShareMember[] }
  return json.members ?? []
}

export async function addAfsShareMember(
  workspaceId: string,
  shareId: string,
  targetWorkspaceId: string,
  readonly: boolean,
): Promise<AfsShareMember> {
  const resp = await fetch(`/api/workspaces/${workspaceId}/afs/shares/${shareId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: targetWorkspaceId, readonly }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `grant failed: ${resp.status}`)
  }
  return (await resp.json()) as AfsShareMember
}

export async function removeAfsShareMember(
  workspaceId: string,
  shareId: string,
  memberWorkspaceId: string,
): Promise<void> {
  const resp = await fetch(
    `/api/workspaces/${workspaceId}/afs/shares/${shareId}/members/${memberWorkspaceId}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `status ${resp.status}` }))
    throw new Error(err.error ?? `remove member failed: ${resp.status}`)
  }
}
