import { Hono } from 'hono'
import type { WorkspaceAppEnv } from '../../lib/types'
import { caller, requireWorkspaceParam } from '../../middleware/workspace-auth'
import { toWorkspaceSkillDtos } from '../../services/skill-repository'
import { skillRepo } from '../../services/skills-composition'
import { skillsContentFetch, skillsContentUrl } from '../../services/skills-content'

const skills = new Hono<WorkspaceAppEnv>()

// Download skill package (tar.gz binary).
//
// No workspace binding on this one: a package is addressed by skill id, and a
// workspace may legitimately mount a skill it does not own, so there is no id
// in the path to bind against. Holding a valid token is the bar — still a bar
// the unauthenticated predecessor did not have. p3 hot path: the workspace agent hits
// it on startup to stamp skills onto its filesystem. We proxy to
// skills-content-service so cp never materializes the tarball.
//
// Route keys on skill UUID now — names are no longer globally unique, so the
// previous `/skills/:name` form can't disambiguate cross-owner. agent-skills
// resolves `id` at list time (via `/workspace/v1/workspaces/:id/skills`) and uses it
// here.
const PACKAGE_PASSTHROUGH = ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified']
skills.get('/v1/skills/:id/package', async (c) => {
  const id = c.req.param('id')
  const url = skillsContentUrl(id, '/package')
  // Forward the agent's conditional-download header so scs can answer 304 when
  // the active version is unchanged (see skills-content-service package route).
  const inm = c.req.header('If-None-Match')
  const result = await skillsContentFetch(
    url,
    c.req.raw.signal,
    inm ? { 'If-None-Match': inm } : undefined,
  )
  if (!result.ok) return c.json({ error: result.error }, 502)
  const { response } = result
  if (response.status === 404) return c.json({ error: 'Skill not found' }, 404)
  if (response.status === 304) {
    const headers = new Headers()
    const etag = response.headers.get('ETag')
    if (etag) headers.set('ETag', etag)
    return new Response(null, { status: 304, headers })
  }
  if (!response.ok) return c.json({ error: `Upstream returned ${response.status}` }, 502)
  const headers = new Headers()
  for (const h of PACKAGE_PASSTHROUGH) {
    const v = response.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/gzip')
  return new Response(response.body, { status: response.status, headers })
})

// Get workspace skill list. p3: returns the canonical UUIDs plus display names
// resolved via JOIN. Old shape exposed only names, but names aren't globally
// unique now — agents and the web app should switch to id-keyed lookups.
skills.get('/v1/workspaces/:id/skills', requireWorkspaceParam(), async (c) => {
  const id = c.req.param('id')
  // One JOIN query for the skill rows; the owner comes from the token, which
  // already read the workspace row. (Previously this fanned out into
  // 1 + N×(getSkillMeta + getSource) round-trips per workspace skill.)
  const rows = await skillRepo.getWorkspaceSkillsForAgent(id)
  const skills = toWorkspaceSkillDtos(rows, caller(c).userId)
  // TODO(agent-skills): legacy agent-skills clients consume `{ name, editable,
  // gitSource }` shape. Once the agent-side client is updated to read `id`,
  // drop the duplicated `name` field at the top level.
  return c.json({ skills })
})

export default skills
