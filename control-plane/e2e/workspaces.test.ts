import { afterAll, describe, expect, test } from 'vitest'
import { client } from './setup'

async function waitForStatus(wsId: string, target: 'running' | 'stopped', maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const list = await client.workspaces.list()
    const ws = list.find((w) => w.id === wsId)
    if (ws?.status === target) return ws
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Workspace did not reach ${target} within ${maxWaitMs}ms`)
}

describe('workspace lifecycle', () => {
  let wsId: string
  let providerId: string
  let tagId: string

  afterAll(async () => {
    // Clean up resources created during tests
    try {
      if (wsId) await client.workspaces.delete(wsId)
    } catch {}
    try {
      if (providerId) await client.providers.delete(providerId)
    } catch {}
    try {
      if (tagId) await client.tags.delete(tagId)
    } catch {}
  })

  test('create workspace', async () => {
    const ws = await client.workspaces.create({ name: 'e2e-test-ws' })
    expect(ws.id).toBeDefined()
    expect(ws.name).toBe('e2e-test-ws')
    expect(ws.status).toBeDefined()
    wsId = ws.id
  })

  test('list workspaces and search filter', async () => {
    const all = await client.workspaces.list()
    expect(all.some((w) => w.id === wsId)).toBe(true)

    const filtered = await client.workspaces.list({ search: 'e2e-test-ws' })
    expect(filtered.some((w) => w.id === wsId)).toBe(true)

    const noMatch = await client.workspaces.list({ search: 'nonexistent-workspace-xyz' })
    expect(noMatch.some((w) => w.id === wsId)).toBe(false)
  })

  test('rename workspace', async () => {
    await client.workspaces.rename(wsId, 'e2e-test-ws-renamed')
    const list = await client.workspaces.list({ search: 'e2e-test-ws-renamed' })
    const ws = list.find((w) => w.id === wsId)
    expect(ws?.name).toBe('e2e-test-ws-renamed')
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
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY env var is required')

    const provider = await client.providers.create({
      name: 'e2e-openrouter',
      provider_type: 'anthropic-oauth',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: OPENROUTER_API_KEY,
    })
    expect(provider.id).toBeDefined()
    providerId = provider.id

    await client.workspaces.updateConfig(wsId, {
      model: 'stepfun/step-3.5-flash:free',
      provider_id: providerId,
    })
  })

  test('start workspace and wait for running', async () => {
    await client.workspaces.start(wsId)
    const ws = await waitForStatus(wsId, 'running', 120_000)
    expect(ws.status).toBe('running')
  }, 130_000)

  test('status shows k8s status', async () => {
    const status = await client.workspaces.status(wsId)
    expect(status).toBeDefined()
    expect(typeof status).toBe('object')
  })

  test('stop workspace and wait for stopped', async () => {
    await client.workspaces.stop(wsId)
    const ws = await waitForStatus(wsId, 'stopped', 120_000)
    expect(ws.status).toBe('stopped')
  }, 130_000)

  test('template config resolution', async () => {
    // Create a template with a version that has specific config
    const template = await client.templates.create({
      name: 'e2e-config-tpl',
      description: 'Template for config resolution test',
    })

    const version = await client.templates.createVersion(template.id, {
      agent_type: 'claude-code',
      system_prompt: 'You are a template-resolved assistant.',
      model: 'test-model-from-template',
      small_model: 'test-small-model-from-template',
      mcp_config: {},
      agent_settings: {},
      compute_resources: {},
    })

    // Bind workspace to template
    await client.workspaces.updateConfig(wsId, {
      template_id: template.id,
      template_version: version.version,
    })

    // Verify config resolves from template
    const config = await client.workspaces.getConfig(wsId)
    expect(config.template_id).toBe(template.id)
    expect(config.template_version).toBe(version.version)
    expect(config.template_name).toBe('e2e-config-tpl')
    expect(config.agent_type).toBe('claude-code')
    expect(config.system_prompt).toBe('You are a template-resolved assistant.')
    expect(config.model).toBe('test-model-from-template')
    expect(config.small_model).toBe('test-small-model-from-template')

    // Clean up: unbind template, delete template
    await client.workspaces.updateConfig(wsId, {
      template_id: null,
      template_version: null,
    })
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
      agent_type: 'claude-code',
      system_prompt: '',
      mcp_config: {},
      agent_settings: {},
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
      agent_type: 'claude-code',
      system_prompt: '',
      prompt_id: libPrompt.id,
      mcp_config: {},
      agent_settings: {},
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
