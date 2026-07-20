import type { ApiSkill } from '../../internal/types/api'
import { client, profile, scoped } from './setup'

// Shared fixtures for specs that need more than a bare resource.

/**
 * A model provider pointed at the profile's LLM endpoint. Conversation specs
 * run against a real model — there is no stub, because the thing under test is
 * whether a deployed agent can actually reach one.
 */
export async function createLlmProvider(label: string) {
  return client.providers.create({
    name: scoped(label),
    provider_type: profile.llm.providerType,
    base_url: profile.llm.baseUrl,
    api_key: profile.llm.apiKey,
  })
}

/**
 * Poll until a workspace reaches `target`. Startup goes through the placement
 * reconciler and pulls an agent image, so the default budget is generous.
 */
export async function waitForStatus(
  wsId: string,
  target: 'running' | 'stopped',
  maxWaitMs = 240_000,
) {
  const start = Date.now()
  let last: string | undefined
  while (Date.now() - start < maxWaitMs) {
    const list = await client.workspaces.list()
    const ws = list.find((w) => w.id === wsId)
    if (ws?.status === target) return ws
    last = ws?.status
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(
    `Workspace ${wsId} stayed in "${last ?? 'unknown'}" and never reached "${target}" ` +
      `within ${maxWaitMs}ms`,
  )
}

/**
 * Point an existing workspace at the profile's model. Note this does NOT change
 * the agent image the pod runs — see createRunningWorkspace below for why.
 */
export async function useLlm(wsId: string, providerId: string, agentType: string) {
  await client.workspaces.updateConfig(wsId, {
    model: profile.llm.model,
    small_model: profile.llm.model,
    provider_id: providerId,
    agent_type: agentType,
  })
}

/**
 * Create a workspace already wired to the profile's model and agent core, then
 * start it and wait for the agent to be up.
 *
 * The agent config has to go in at creation time. The placement spec — which
 * decides the agent image the pod runs — is built once, when the workspace is
 * created; `updateConfig` only rebuilds it for compute_resources changes, and
 * `start` does not rebuild it at all. Creating bare and configuring afterwards
 * therefore boots the *seeded default* core against this profile's endpoint,
 * which surfaces as the agent answering "Not logged in · Please run /login".
 */
export async function createRunningWorkspace(label: string, providerId: string, agentType: string) {
  const ws = await client.workspaces.create({
    name: scoped(label),
    agent_type: agentType,
    provider_id: providerId,
    model: profile.llm.model,
    small_model: profile.llm.model,
  })
  await client.workspaces.start(ws.id)
  await waitForStatus(ws.id, 'running')
  return ws
}

/**
 * Skills owned by this run, for specs that need skill names to resolve.
 * Created through the API rather than seeded into the database, which is what
 * the old local harness had to do when it ran without skills-content-service.
 */
export async function createSkills(names: string[]): Promise<ApiSkill[]> {
  const created: ApiSkill[] = []
  for (const name of names) {
    const { skill } = await client.skills.createNative({
      name: scoped(name),
      description: `e2e fixture: ${name}`,
      visibility: 'private',
    })
    created.push(skill)
  }
  return created
}
