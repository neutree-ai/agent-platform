/**
 * Public skill registry — serves one exported skill over the Agent Skills
 * `.well-known` discovery protocol so local agents can install it with the
 * stock client:
 *
 *     npx skills add https://<host>/sk/<token>
 *
 * The client probes `<base>/.well-known/agent-skills/index.json`, validates
 * each entry, fetches the archive, and verifies its sha256 against the
 * declared digest. Spec: https://github.com/cloudflare/agent-skills-discovery-rfc
 *
 * Mounted at `/sk` and bypasses auth: the token is the only authenticator
 * (128-bit random, TTL-bounded, revocable), exactly like export_tokens. It
 * grants exactly one skill, so a leaked URL has a one-skill blast radius.
 *
 * Unlike file exports this rides the main app origin rather than a separate
 * `files.*` host. That split exists so inline HTML can't reach app cookies;
 * here every response is JSON or gzip served with `nosniff` and an attachment
 * disposition, so nothing is ever rendered as a document.
 */
import { Hono } from 'hono'
import {
  type SkillExportTokenTarget,
  getActiveSkillExportToken,
  touchSkillExportToken,
} from '../services/db/skill-export-tokens'
import { skillsContentFetch, skillsContentUrl } from '../services/skills-content'

export const skillRegistryApp = new Hono()

/** Discovery path the client probes, relative to the export's base URL. */
const WELL_KNOWN = '.well-known/agent-skills'

/**
 * `description` must be non-empty and ≤1024 chars or the client drops the
 * entry. `skills.description` defaults to '' and plenty of rows keep it.
 */
function registryDescription(record: SkillExportTokenTarget): string {
  const raw = record.skill_description.trim()
  if (!raw) return record.slug
  return raw.length > 1024 ? `${raw.slice(0, 1021)}...` : raw
}

function logServe(c: any, token: string, record: SkillExportTokenTarget, what: string) {
  // Log a token prefix only. export_tokens logs the full value, which turns a
  // log leak into a credential leak; not repeating that here.
  console.log(
    `[skill-registry] serve ${what} token=${token.slice(0, 12)}… skill=${record.skill_id} ` +
      `ip=${c.req.header('x-forwarded-for') || 'unknown'} ua=${c.req.header('user-agent') || '-'}`,
  )
}

/** Resolve a token, or a Response to short-circuit on. */
async function resolveExport(c: any, token: string): Promise<SkillExportTokenTarget | Response> {
  const record = await getActiveSkillExportToken(token)
  if (!record) return c.text('Not found or expired', 404)
  if (!record.content_hash) {
    // Skill exists but was never published — there is no package to serve.
    return c.text('Skill has no published version', 404)
  }
  return record
}

/**
 * Discovery index. One entry, because an export grants one skill.
 *
 * `digest` is the skill's active-version content_hash — a generated column
 * over the stored tarball — so it needs no separate computation and is exactly
 * what the client hashes on arrival. Because we read the *active* version, a
 * republish changes both the index digest and the served bytes together.
 */
skillRegistryApp.get(`/:token/${WELL_KNOWN}/index.json`, async (c) => {
  const token = c.req.param('token')
  const record = await resolveExport(c, token)
  if (record instanceof Response) return record

  logServe(c, token, record, 'index')
  void touchSkillExportToken(token)

  return c.json(
    {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        {
          // Stored at mint time, so renaming the skill can't retarget an
          // install that is already on someone's disk.
          name: record.slug,
          type: 'archive',
          description: registryDescription(record),
          // Relative to the index URL, per RFC 3986 resolution.
          url: `${record.slug}.tar.gz`,
          digest: `sha256:${record.content_hash}`,
        },
      ],
    },
    200,
    {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  )
})

/**
 * Archive fetch. The `.tar.gz` basename is cosmetic — the token already
 * identifies the skill — so any name resolves, mirroring how export tokens
 * treat their URL tail.
 *
 * Proxied straight from skills-content-service; cp never materializes the
 * tarball. ETag is passed through so a client that keeps it gets a cheap 304
 * (scs answers from content_hash without reading the bytea).
 */
skillRegistryApp.get(`/:token/${WELL_KNOWN}/:filename{.+\\.tar\\.gz}`, async (c) => {
  const token = c.req.param('token')
  const record = await resolveExport(c, token)
  if (record instanceof Response) return record

  const inm = c.req.header('If-None-Match')
  const result = await skillsContentFetch(
    skillsContentUrl(record.skill_id, '/package'),
    c.req.raw.signal,
    inm ? { 'If-None-Match': inm } : undefined,
  )
  if (!result.ok) return c.text('Skill content unavailable', 502)

  const { response } = result
  if (response.status === 404) return c.text('Not found', 404)

  logServe(c, token, record, 'package')
  void touchSkillExportToken(token)

  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  })
  const etag = response.headers.get('ETag')
  if (etag) headers.set('ETag', etag)

  if (response.status === 304) return new Response(null, { status: 304, headers })
  if (!response.ok) return c.text('Skill content unavailable', 502)

  headers.set('Content-Type', 'application/gzip')
  headers.set('Content-Disposition', `attachment; filename="${record.slug}.tar.gz"`)
  const cl = response.headers.get('Content-Length')
  if (cl) headers.set('Content-Length', cl)
  return new Response(response.body, { status: 200, headers })
})

/**
 * Bare export URL. Not part of the protocol — a human who opens the link in a
 * browser lands here, so answer with the command they actually need.
 */
skillRegistryApp.get('/:token', async (c) => {
  const token = c.req.param('token')
  const record = await resolveExport(c, token)
  if (record instanceof Response) return record
  const base = new URL(c.req.url)
  base.search = ''
  return c.text(
    `${record.skill_name}\n\nInstall with:\n  npx skills add ${base.toString()}\n`,
    200,
    { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  )
})

skillRegistryApp.all('*', (c) => c.text('Not found', 404))

/**
 * Host-root discovery probe. The client checks `<host>/.well-known/...` as
 * well as the base URL it was given, and this app publishes nothing there —
 * every export is scoped to a token path.
 *
 * Answered explicitly because the alternative is worse: the path would fall
 * through to the SPA and return `200 text/html`, which a client looking for
 * JSON reports as a parse failure rather than "nothing here".
 */
export const wellKnownRootApp = new Hono()
wellKnownRootApp.all('*', (c) => c.json({ error: 'No skills published at this host' }, 404))
