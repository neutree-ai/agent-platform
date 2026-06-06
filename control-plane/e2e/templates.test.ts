import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('templates CRUD', () => {
  let templateId: string
  let versionNumber: number

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

  test('createVersion with agent_type, system_prompt, and skill_names', async () => {
    const version = await client.templates.createVersion(templateId, {
      agent_type: 'claude-code',
      system_prompt: 'You are a helpful coding assistant for e2e tests.',
      model: 'claude-sonnet-4-20250514',
      small_model: '',
      mcp_config: {},
      agent_settings: {},
      compute_resources: {},
      skill_names: ['gitlab-rest-api', 'slack-web-api'],
    })
    expect(version.id).toBeTruthy()
    expect(version.template_id).toBe(templateId)
    expect(version.version).toBeGreaterThanOrEqual(1)
    expect(version.agent_type).toBe('claude-code')
    expect(version.system_prompt).toBe('You are a helpful coding assistant for e2e tests.')
    expect(version.skill_names).toEqual(['gitlab-rest-api', 'slack-web-api'])
    versionNumber = version.version
  })

  test('listVersions contains created version', async () => {
    const versions = await client.templates.listVersions(templateId)
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const found = versions.find((v) => v.version === versionNumber)
    expect(found).toBeDefined()
    expect(found!.agent_type).toBe('claude-code')
  })

  test('getVersion matches created version', async () => {
    const version = await client.templates.getVersion(templateId, versionNumber)
    expect(version.version).toBe(versionNumber)
    expect(version.agent_type).toBe('claude-code')
    expect(version.system_prompt).toBe('You are a helpful coding assistant for e2e tests.')
    expect(version.skill_names).toEqual(['gitlab-rest-api', 'slack-web-api'])
  })

  test('delete template', async () => {
    await client.templates.delete(templateId)

    const templates = await client.templates.list()
    const found = templates.find((t) => t.id === templateId)
    expect(found).toBeUndefined()
  })
})
