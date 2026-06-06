/**
 * Composition root for the skills bounded context.
 *
 * Singleton `skillsService` is built here once at module load and imported by
 * everything that talks to skills: `routes/skills.ts`, the skills branch of
 * `routes/internal.ts`, and `mcp/tools/skills.ts`. Keeping the wiring in one
 * file lets the SkillsService class itself stay test-only (no production
 * imports — class file pulls in pool transitively).
 *
 * The `deps` bag adapts two single-method needs (team membership lookup +
 * workspace lookup for attach). Credential resolution and git client moved to
 * route handlers / skills-content-service in p1.5.
 */
import { QueueReloadEnqueuer } from '../lib/skill-reload-queue'
import { HttpAgentNotifier } from './agent-notifier'
import { getTeamMembership } from './db/teams'
import { getWorkspace } from './db/workspaces'
import { PgSkillRepository } from './skill-repository'
import { SkillsService } from './skills-service'

/**
 * Repository singleton, also exported so non-user-facing callers (internal
 * routes, shares, template versions, builder-mode reads, mcp tools) reach the
 * persistence layer without routing through the user-facing SkillsService.
 * See skill-repository.ts header for why this two-tier surface exists.
 */
export const skillRepo = new PgSkillRepository()

export const skillsService = new SkillsService(
  skillRepo,
  new HttpAgentNotifier(),
  {
    async isTeamMember(teamId, userId) {
      return !!(await getTeamMembership(teamId, userId))
    },
    async getWorkspaceForAttach(workspaceId) {
      const ws = await getWorkspace(workspaceId)
      if (!ws) return null
      return { user_id: ws.user_id, status: ws.status }
    },
  },
  new QueueReloadEnqueuer(),
)
