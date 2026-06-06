/**
 * Thin HTTP client for skills-content-service.
 *
 * Service split (p3): scs owns all writes to `skills`, `skill_sources`,
 * `skill_versions`. cp READS them directly via the shared Postgres pool but
 * never WRITES — every mutation goes via the helpers below. cp orchestrates
 * (validates ACL, snapshots dependents, fires reload notifications) before
 * and after the call.
 *
 * Endpoint surface is documented in tmp/skills-p3-plan.md §scs-api. The
 * client mirrors that 1:1 — no hidden retries, no fallback paths. Errors
 * become `{ok: false, status, error}` so route handlers can decide HTTP
 * surface without try/catch noise.
 *
 * Env: SKILLS_CONTENT_URL (default: http://nap-skills:3008)
 */

import type { SkillMeta, SkillSource, SkillVersion } from './db/types'

const SKILLS_CONTENT_URL = process.env.SKILLS_CONTENT_URL || 'http://nap-skills:3008'

// ── result shape ───────────────────────────────────────────────────────────

export type ScsResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; body?: Record<string, unknown> }

// ── read paths ─────────────────────────────────────────────────────────────
//
// File browser & raw-version download remain as direct proxies — cp gates by
// ACL upstream and forwards. The URL builders are kept exported so route
// handlers can reach the upstream Response object without owning the path
// shape (which changes with the id ↔ name pivot).

/**
 * Build a URL into scs for a given skill (by UUID). `sub` is the path tail
 * starting with `/`; `search` includes the leading `?` when present.
 */
export function skillsContentUrl(skillId: string, sub: string, search = ''): string {
  return `${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}${sub}${search}`
}

/**
 * GET passthrough. Returns the upstream Response so the route can decide
 * how to surface headers/body. Network failure resolves to `{ok: false}`.
 */
export async function skillsContentFetch(
  url: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'identity', ...(extraHeaders ?? {}) },
      signal,
    })
    return { ok: true, response }
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, error: 'Client disconnected' }
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skills-content] fetch failed ${url}:`, msg)
    return { ok: false, error: 'skills-content-service unavailable' }
  }
}

// ── scan (pure parse, no side effects) ─────────────────────────────────────

export interface ScanCandidate {
  subpath: string
  name: string | null
  description: string | null
  fileCount: number
  files: Array<{ path: string; size: number }>
  skillMd: string | null
}

interface ScanGitInput {
  url: string
  type?: string
  ref?: string
  token?: string
}

export interface ScanGitResult {
  candidates: ScanCandidate[]
  requested_subpath: string | null
  commit_sha: string | null
}

export async function scsScanGit(
  body: ScanGitInput,
  signal?: AbortSignal,
): Promise<ScsResult<ScanGitResult>> {
  return doJsonPost(`${SKILLS_CONTENT_URL}/scan-git`, body, signal)
}

export async function scsScanTarball(args: {
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}): Promise<ScsResult<{ candidates: ScanCandidate[] }>> {
  return doStreamPost(
    'POST',
    `${SKILLS_CONTENT_URL}/scan-tarball`,
    args.body,
    { 'Content-Type': 'application/gzip' },
    args.contentLength,
    args.signal,
  )
}

// ── sources ────────────────────────────────────────────────────────────────

interface CreateNativeSourceInput {
  user_id: string
  name: string
  description: string
  visibility: 'private' | 'team' | 'public'
  category?: string | null
}

/** Atomic: create source + create skill (active_version_id=NULL). */
export async function scsCreateNativeSource(
  body: CreateNativeSourceInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ source: SkillSource; skill: SkillMeta }>> {
  return doJsonPost(`${SKILLS_CONTENT_URL}/sources/native`, body, signal)
}

export interface ImportFromGitInput {
  user_id: string
  url: string
  type?: string
  ref?: string
  token?: string
  credential_name?: string | null
  subpath: string
  // Optional metadata overrides — if not provided, derived from SKILL.md
  // frontmatter in the imported subpath.
  name?: string
  description?: string
  visibility: 'private' | 'team' | 'public'
  category?: string | null
}

/**
 * Ensure source + create skill + initial version in one call. Idempotent on
 * source via `find_or_create (user_id, url, ref)` server-side, so reusing the
 * same monorepo across subpaths only creates one source row.
 */
export async function scsImportFromGit(
  body: ImportFromGitInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }>> {
  return doJsonPost(`${SKILLS_CONTENT_URL}/sources/git/import`, body, signal)
}

interface SwitchToGitInput {
  user_id: string
  url: string
  type?: string
  ref?: string
  token?: string
  credential_name?: string | null
  subpath: string
}

/**
 * Switch an existing native skill to a git source in place. Keeps the skill
 * UUID (mounts survive) but wipes its native version history. scs validates
 * the git subpath before the destructive repoint, so a bad URL leaves the
 * skill untouched.
 */
export async function scsSwitchSkillToGit(
  skillId: string,
  body: SwitchToGitInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }>> {
  return doJsonPost(
    `${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}/switch-to-git`,
    body,
    signal,
  )
}

interface SyncSourceInput {
  token?: string
  published_by: string
}

interface SyncResultRow {
  skill_id: string
  version_id: string
  content_hash: string
  changed: boolean
}

export interface SyncResult {
  source: SkillSource
  results: SyncResultRow[]
  commit_sha: string | null
}

export async function scsSyncSource(
  sourceId: string,
  body: SyncSourceInput,
  signal?: AbortSignal,
): Promise<ScsResult<SyncResult>> {
  return doJsonPost(
    `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}/sync`,
    body,
    signal,
  )
}

interface PatchSourceInput {
  credential_name?: string | null
  git_ref?: string
}

export async function scsPatchSource(
  sourceId: string,
  body: PatchSourceInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ source: SkillSource }>> {
  return doJsonPatch(`${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}`, body, signal)
}

export async function scsDeleteSource(
  sourceId: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ ok: true }>> {
  return doMethodNoBody(
    'DELETE',
    `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}`,
    signal,
  )
}

// ── draft (native sources only) ────────────────────────────────────────────

export async function scsPutDraft(args: {
  sourceId: string
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}): Promise<ScsResult<{ ok: true; byte_count: number }>> {
  return doStreamPost(
    'PUT',
    `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(args.sourceId)}/draft`,
    args.body,
    { 'Content-Type': 'application/gzip' },
    args.contentLength,
    args.signal,
  )
}

export async function scsDeleteDraft(
  sourceId: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ ok: true }>> {
  return doMethodNoBody(
    'DELETE',
    `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}/draft`,
    signal,
  )
}

// ── per-file draft editing ─────────────────────────────────────────────────

export interface DraftFileNode {
  path: string
  type: 'file' | 'dir'
  size?: number
}

export async function scsListDraftTree(
  sourceId: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ entries: DraftFileNode[] }>> {
  return doJsonGet(
    `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}/draft/files`,
    signal,
  )
}

export function scsDraftFileUrl(sourceId: string, path: string): string {
  return `${SKILLS_CONTENT_URL}/sources/${encodeURIComponent(sourceId)}/draft/file?path=${encodeURIComponent(path)}`
}

export async function scsPutDraftFile(args: {
  sourceId: string
  path: string
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}): Promise<ScsResult<{ ok: true; byte_count: number }>> {
  return doStreamPost(
    'PUT',
    scsDraftFileUrl(args.sourceId, args.path),
    args.body,
    { 'Content-Type': 'application/octet-stream' },
    args.contentLength,
    args.signal,
  )
}

export async function scsDeleteDraftFile(
  sourceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ ok: true }>> {
  return doMethodNoBody('DELETE', scsDraftFileUrl(sourceId, path), signal)
}

// ── upload (one-shot: source + skill + first version) ─────────────────────

export interface UploadInput {
  user_id: string
  name: string
  description: string
  visibility: 'private' | 'team' | 'public'
  category?: string | null
}

export async function scsUploadSkill(args: {
  meta: UploadInput
  body: ReadableStream<Uint8Array>
  contentLength?: number
  signal?: AbortSignal
}): Promise<ScsResult<{ source: SkillSource; skill: SkillMeta; version: SkillVersion }>> {
  const params = new URLSearchParams({
    user_id: args.meta.user_id,
    name: args.meta.name,
    description: args.meta.description,
    visibility: args.meta.visibility,
  })
  if (args.meta.category != null) params.set('category', args.meta.category)
  return doStreamPost(
    'POST',
    `${SKILLS_CONTENT_URL}/skills/upload?${params.toString()}`,
    args.body,
    { 'Content-Type': 'application/gzip' },
    args.contentLength,
    args.signal,
  )
}

// ── publish (read source.draft_package → create version + set active) ────

interface PublishInput {
  published_by: string
  note?: string
}

export async function scsPublishSkill(
  skillId: string,
  body: PublishInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ skill: SkillMeta; version: SkillVersion }>> {
  return doJsonPost(
    `${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}/publish`,
    body,
    signal,
  )
}

// ── version ops ────────────────────────────────────────────────────────────

export async function scsSetActiveVersion(
  skillId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ skill: SkillMeta }>> {
  return doJsonPut(
    `${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}/active-version`,
    { version_id: versionId },
    signal,
  )
}

// ── skill metadata + delete ────────────────────────────────────────────────

interface PatchSkillInput {
  name?: string
  description?: string
  visibility?: 'private' | 'team' | 'public'
  category?: string | null
}

export async function scsPatchSkill(
  skillId: string,
  body: PatchSkillInput,
  signal?: AbortSignal,
): Promise<ScsResult<{ skill: SkillMeta }>> {
  return doJsonPatch(`${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}`, body, signal)
}

export async function scsDeleteSkill(
  skillId: string,
  signal?: AbortSignal,
): Promise<ScsResult<{ ok: true }>> {
  return doMethodNoBody(
    'DELETE',
    `${SKILLS_CONTENT_URL}/skills/${encodeURIComponent(skillId)}`,
    signal,
  )
}

// ── transport helpers ──────────────────────────────────────────────────────

async function doJsonGet<T>(url: string, signal: AbortSignal | undefined): Promise<ScsResult<T>> {
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', signal })
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, status: 499, error: 'Client disconnected' }
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skills-content] GET ${url} failed:`, msg)
    return { ok: false, status: 502, error: 'skills-content-service unavailable' }
  }
  return decodeResponse<T>(response)
}

async function doJsonPost<T>(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  return doJson('POST', url, body, signal)
}

async function doJsonPut<T>(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  return doJson('PUT', url, body, signal)
}

async function doJsonPatch<T>(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  return doJson('PATCH', url, body, signal)
}

async function doJson<T>(
  method: string,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, status: 499, error: 'Client disconnected' }
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skills-content] ${method} ${url} failed:`, msg)
    return { ok: false, status: 502, error: 'skills-content-service unavailable' }
  }
  return decodeResponse<T>(response)
}

async function doMethodNoBody<T>(
  method: 'DELETE',
  url: string,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  let response: Response
  try {
    response = await fetch(url, { method, signal })
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, status: 499, error: 'Client disconnected' }
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skills-content] ${method} ${url} failed:`, msg)
    return { ok: false, status: 502, error: 'skills-content-service unavailable' }
  }
  return decodeResponse<T>(response)
}

async function doStreamPost<T>(
  method: 'POST' | 'PUT',
  url: string,
  body: ReadableStream<Uint8Array>,
  baseHeaders: Record<string, string>,
  contentLength: number | undefined,
  signal: AbortSignal | undefined,
): Promise<ScsResult<T>> {
  const headers = { ...baseHeaders }
  if (contentLength !== undefined) headers['Content-Length'] = String(contentLength)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      // undici-specific: required when the request body is a stream.
      // @ts-expect-error duplex is undici-specific
      duplex: 'half',
      signal,
    })
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, status: 499, error: 'Client disconnected' }
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[skills-content] ${method} ${url} failed:`, msg)
    return { ok: false, status: 502, error: 'skills-content-service unavailable' }
  }
  return decodeResponse<T>(response)
}

async function decodeResponse<T>(response: Response): Promise<ScsResult<T>> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    const error =
      typeof body.error === 'string' ? body.error : `Upstream returned ${response.status}`
    return { ok: false, status: response.status, error, body }
  }
  if (response.status === 204) return { ok: true, value: undefined as unknown as T }
  return { ok: true, value: (await response.json()) as T }
}
