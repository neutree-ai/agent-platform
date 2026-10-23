import { describe, expect, it } from 'vitest'
import { SpecError, parseAppSpec } from './schema'

const minimal = {
  apiVersion: 'nap.app/v1',
  agents: {
    study: {
      runtime: { agent_type: 'claude-code' },
      model: { provider: 'deepseek', name: 'deepseek-v4' },
    },
  },
}

function issues(body: unknown, contentType = 'application/json'): string[] {
  try {
    parseAppSpec(typeof body === 'string' ? body : JSON.stringify(body), contentType)
  } catch (e) {
    if (e instanceof SpecError) return e.issues
    throw e
  }
  return []
}

describe('parseAppSpec', () => {
  it('reads JSON, and YAML by content type', () => {
    const yaml = `
apiVersion: nap.app/v1
agents:
  study:
    runtime: { agent_type: claude-code }
    model: { provider: deepseek, name: deepseek-v4 }
`
    const fromJson = parseAppSpec(JSON.stringify(minimal), 'application/json')
    const fromYaml = parseAppSpec(yaml, 'application/yaml')
    expect(fromYaml.spec).toEqual(fromJson.spec)
    expect(fromYaml.document).toEqual(minimal)
  })

  it('refuses unknown fields and other api versions', () => {
    expect(issues({ ...minimal, roles: {} })).toEqual([expect.stringContaining('roles')])
    expect(issues({ ...minimal, apiVersion: 'nap.app/v2' })).toHaveLength(1)
    const agent = { ...minimal.agents.study, layout: {} }
    expect(issues({ ...minimal, agents: { study: agent } })[0]).toMatch(/^agents\.study/)
  })

  it('takes prompts as a name with an optional version', () => {
    const withPrompt = (prompt: string) => ({
      ...minimal,
      agents: { study: { ...minimal.agents.study, prompt } },
    })
    expect(issues(withPrompt('study'))).toEqual([])
    expect(issues(withPrompt('study@3'))).toEqual([])
    expect(issues(withPrompt('study@0'))).toHaveLength(1)
    expect(issues(withPrompt('study@latest'))).toHaveLength(1)
  })

  it('checks that mcp and calls name things the spec declares', () => {
    const agent = { ...minimal.agents.study, mcp: { whale: {} }, calls: ['diver', 'study'] }
    expect(issues({ ...minimal, agents: { study: agent } })).toEqual([
      'agents.study.mcp.whale: not one of mcp_servers',
      'agents.study.calls: diver is not another agent of the spec',
      'agents.study.calls: study is not another agent of the spec',
    ])
  })

  it('checks schedules', () => {
    const agent = {
      ...minimal.agents.study,
      schedules: { daily: { cron: 'every morning', prompt: 'Plan today' } },
    }
    expect(issues({ ...minimal, agents: { study: agent } })[0]).toMatch(/invalid cron/)
  })

  it('reports a body that does not parse', () => {
    expect(issues('{', 'application/json')[0]).toMatch(/^not valid JSON/)
    expect(issues('a: [', 'application/yaml')[0]).toMatch(/^not valid YAML/)
  })
})
