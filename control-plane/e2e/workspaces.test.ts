import { afterAll, expect, test } from 'vitest'
import { createLlmProvider, useLlm, waitForStatus } from './fixtures'
import { agentCores, client, describeIfK8s, scoped } from './setup'

describeIfK8s('workspace lifecycle', () => {
  let wsId: string
  let providerId: string
  let tagId: string

  afterAll(async () => {
    // Stop before delete so the reconciler reclaims the workspace's Kubernetes
    // resources instead of leaving them orphaned.
    try {
      if (wsId) {
        await client.workspaces.stop(wsId).catch(() => {})
        await waitForStatus(wsId, 'stopped', 90_000).catch(() => {})
        await client.workspaces.delete(wsId)
      }
    } catch {}
    try {
      if (providerId) await client.providers.delete(providerId)
    } catch {}
    try {
      if (tagId) await client.tags.delete(tagId)
    } catch {}
  })

  test('create workspace', async () => {
    const ws = await client.workspaces.create({ name: scoped('ws') })
    expect(ws.id).toBeDefined()
    expect(ws.name).toBe(scoped('ws'))
    expect(ws.status).toBeDefined()
    wsId = ws.id
  })

  test('list workspaces and search filter', async () => {
    const all = await client.workspaces.list()
    expect(all.some((w) => w.id === wsId)).toBe(true)

    const filtered = await client.workspaces.list({ search: scoped('ws') })
    expect(filtered.some((w) => w.id === wsId)).toBe(true)

    const noMatch = await client.workspaces.list({ search: 'nonexistent-workspace-xyz' })
    expect(noMatch.some((w) => w.id === wsId)).toBe(false)
  })

  test('rename workspace', async () => {
    await client.workspaces.rename(wsId, scoped('ws-renamed'))
    const list = await client.workspaces.list({ search: scoped('ws-renamed') })
    const ws = list.find((w) => w.id === wsId)
    expect(ws?.name).toBe(scoped('ws-renamed'))
  })

  test('getConfig returns config object', async () => {
    const config = await client.workspaces.getConfig(wsId)
    expect(config).toBeDefined()
    expect(typeof config).toBe('object')
  })

  test('updateConfig and verify', async () => {
    await client.workspaces.updateConfig(wsId, { system_prompt: 'You are a test assistant' })
    const config = await client.workspaces.getConfig(wsId)
    expect(config.system_prompt).toBe('You are a test assistant')
  })

  test('create tag and set workspace tags', async () => {
    const tag = await client.tags.create({ name: 'e2e-tag', color: 'rose' })
    expect(tag.id).toBeDefined()
    expect(tag.name).toBe('e2e-tag')
    tagId = tag.id

    await client.tags.setWorkspaceTags(wsId, [tagId])

    // Verify by listing workspaces with tag filter
    const filtered = await client.workspaces.list({ tag: tagId })
    expect(filtered.some((w) => w.id === wsId)).toBe(true)
  })

  test('create provider and configure workspace for start', async () => {
    const provider = await createLlmProvider('ws-provider')
    expect(provider.id).toBeDefined()
    providerId = provider.id

    await useLlm(wsId, providerId, agentCores[0])
  })

  test('start workspace and wait for running', async () => {
    await client.workspaces.start(wsId)
    const ws = await waitForStatus(wsId, 'running')
    expect(ws.status).toBe('running')
  }, 300_000)

  test('status shows k8s status', async () => {
    const status = await client.workspaces.status(wsId)
    expect(status).toBeDefined()
    expect(typeof status).toBe('object')
  })

  test('stop workspace and wait for stopped', async () => {
    await client.workspaces.stop(wsId)
    const ws = await waitForStatus(wsId, 'stopped', 120_000)
    expect(ws.status).toBe('stopped')
  }, 300_000)

  test('template config resolution', async () => {
    // A fresh workspace, not the shared one. A workspace's own values
    // deliberately win over its template's (see the upgrade test below), and by
    // this point the shared workspace carries a system_prompt and model from
    // earlier tests — which would mask exactly what this test is checking.
    const tplWs = await client.workspaces.create({ name: scoped('tpl-ws') })
    const seededAgentType = (await client.workspaces.getConfig(tplWs.id)).agent_type

    const template = await client.templates.create({
      name: scoped('config-tpl'),
      description: 'Template for config resolution test',
    })

    const version = await client.templates.createVersion(template.id, {
      agent_type: agentCores[0],
      system_prompt: 'You are a template-resolved assistant.',
      model: 'test-model-from-template',
      small_model: 'test-small-model-from-template',
      mcp_config: '{}',
      agent_settings: '{}',
      compute_resources: {},
    })

    await client.workspaces.updateConfig(tplWs.id, {
      template_id: template.id,
      template_version: version.version,
    })

    const config = await client.workspaces.getConfig(tplWs.id)
    expect(config.template_id).toBe(template.id)
    expect(config.template_version).toBe(version.version)
    expect(config.template_name).toBe(scoped('config-tpl'))
    expect(config.system_prompt).toBe('You are a template-resolved assistant.')
    expect(config.model).toBe('test-model-from-template')
    expect(config.small_model).toBe('test-small-model-from-template')

    // agent_type is the exception, and it is structural: workspace creation
    // seeds model / small_model / system_prompt as '' but writes a concrete
    // agent_type. Resolution is COALESCE(NULLIF(wc.agent_type, ''),
    // tv.agent_type), so the workspace's own value always wins and a template
    // can never supply the agent core unless the workspace clears it first.
    expect(config.agent_type).toBe(seededAgentType)

    await client.workspaces.updateConfig(tplWs.id, { agent_type: '' })
    const cleared = await client.workspaces.getConfig(tplWs.id)
    expect(cleared.agent_type).toBe(agentCores[0])

    await client.workspaces.delete(tplWs.id)
    await client.templates.delete(template.id)
  })

  test('template upgrade preserves user system_prompt override', async () => {
    // Regression: when a workspace has a custom system_prompt override and the
    // template is upgraded to a version that introduces a prompt_id, the read
    // layer must not fall back to the template's prompt_id (which would shadow
    // the user's custom prompt at the agent/UI layer).
    const template = await client.templates.create({
      name: 'e2e-upgrade-tpl',
      description: 'Template upgrade override-preservation test',
    })
    const v1 = await client.templates.createVersion(template.id, {
      agent_type: agentCores[0],
      system_prompt: '',
      mcp_config: '{}',
      agent_settings: '{}',
      compute_resources: {},
    })

    await client.workspaces.updateConfig(wsId, {
      template_id: template.id,
      template_version: v1.version,
    })
    await client.workspaces.updateConfig(wsId, { system_prompt: 'CUSTOM USER PROMPT' })

    const libPrompt = await client.prompts.create({
      name: 'e2e-upgrade-lib-prompt',
      content: 'TEMPLATE LIBRARY PROMPT',
    })
    await client.templates.createVersion(template.id, {
      agent_type: agentCores[0],
      system_prompt: '',
      prompt_id: libPrompt.id,
      mcp_config: '{}',
      agent_settings: '{}',
      compute_resources: {},
    })

    await client.workspaces.syncTemplate(wsId)

    const config = await client.workspaces.getConfig(wsId)
    expect(config.system_prompt).toBe('CUSTOM USER PROMPT')
    expect(config.prompt_id).toBeNull()
    expect(config.prompt_content ?? null).toBeNull()

    await client.workspaces.updateConfig(wsId, {
      template_id: null,
      template_version: null,
      system_prompt: '',
    })
    await client.templates.delete(template.id)
    await client.prompts.delete(libPrompt.id)
  })

  test('delete workspace', async () => {
    await client.workspaces.delete(wsId)
    const list = await client.workspaces.list()
    expect(list.some((w) => w.id === wsId)).toBe(false)
    wsId = '' // Prevent afterAll from trying to delete again
  })
})
