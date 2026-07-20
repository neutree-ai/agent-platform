import { beforeAll, describe, expect, test } from 'vitest'
import { createSkills } from './fixtures'
import { agentCores, client } from './setup'

describe('templates CRUD', () => {
  let templateId: string
  let versionNumber: number
  // Skills this run owns. The previous local harness seeded two rows straight
  // into the database because it had no skills-content-service; a deployed
  // target does, so they go through the API.
  let skillIds: string[]
  let skillNames: string[]

  beforeAll(async () => {
    const skills = await createSkills(['tpl-skill-a', 'tpl-skill-b'])
    skillIds = skills.map((s) => s.id)
    skillNames = skills.map((s) => s.name)
  })

  test('create template', async () => {
    const template = await client.templates.create({
      name: 'e2e-template',
      description: 'Template for e2e testing',
    })
    expect(template.id).toBeTruthy()
    expect(template.name).toBe('e2e-template')
    expect(template.description).toBe('Template for e2e testing')
    templateId = template.id
  })

  test('list templates contains created template', async () => {
    const templates = await client.templates.list()
    const found = templates.find((t) => t.id === templateId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('e2e-template')
  })

  test('get template by id', async () => {
    const template = await client.templates.get(templateId)
    expect(template.id).toBe(templateId)
    expect(template.name).toBe('e2e-template')
    expect(template.description).toBe('Template for e2e testing')
  })

  test('update template name', async () => {
    const updated = await client.templates.update(templateId, {
      name: 'e2e-template-updated',
    })
    expect(updated.name).toBe('e2e-template-updated')

    const fetched = await client.templates.get(templateId)
    expect(fetched.name).toBe('e2e-template-updated')
  })

  test('createVersion with agent_type, system_prompt, and skill_ids', async () => {
    const version = await client.templates.createVersion(templateId, {
      agent_type: agentCores[0],
      system_prompt: 'You are a helpful coding assistant for e2e tests.',
      model: 'claude-sonnet-4-20250514',
      small_model: '',
      // The API takes these as JSON strings, not objects.
      mcp_config: '{}',
      agent_settings: '{}',
      compute_resources: {},
      // skill_ids is authoritative; skill_names is rejected outright. Asserting
      // on the names the server sends back checks the id → name resolution.
      skill_ids: skillIds,
    })
    expect(version.id).toBeTruthy()
    expect(version.template_id).toBe(templateId)
    expect(version.version).toBeGreaterThanOrEqual(1)
    expect(version.agent_type).toBe(agentCores[0])
    expect(version.system_prompt).toBe('You are a helpful coding assistant for e2e tests.')
    expect([...(version.skill_names ?? [])].sort()).toEqual([...skillNames].sort())
    versionNumber = version.version
  })

  test('listVersions contains created version', async () => {
    const versions = await client.templates.listVersions(templateId)
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const found = versions.find((v) => v.version === versionNumber)
    expect(found).toBeDefined()
    expect(found!.agent_type).toBe(agentCores[0])
  })

  test('getVersion matches created version', async () => {
    const version = await client.templates.getVersion(templateId, versionNumber)
    expect(version.version).toBe(versionNumber)
    expect(version.agent_type).toBe(agentCores[0])
    expect(version.system_prompt).toBe('You are a helpful coding assistant for e2e tests.')
    expect([...(version.skill_names ?? [])].sort()).toEqual([...skillNames].sort())
  })

  test('delete template', async () => {
    await client.templates.delete(templateId)

    const templates = await client.templates.list()
    const found = templates.find((t) => t.id === templateId)
    expect(found).toBeUndefined()
  })
})
