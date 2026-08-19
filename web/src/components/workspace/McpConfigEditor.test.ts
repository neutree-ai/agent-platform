import { describe, expect, it } from 'vitest'
import { buildMcpJson, parseStructuredState } from './McpConfigEditor'

const knownServers = {
  search: {
    label: 'Search',
    description: '',
    url: 'https://search.example.com/mcp',
    params: [{ header: 'X-Limit', label: 'Limit', type: 'number' as const, default: '10' }],
    group: 'Tools',
  },
  notes: {
    label: 'Notes',
    description: '',
    url: 'https://notes.example.com/mcp',
    params: [],
    group: 'Tools',
  },
}
const knownKeys = Object.keys(knownServers)

function build(
  enabled: Record<string, boolean>,
  present: Record<string, boolean>,
  paramValues: Record<string, Record<string, string>> = {},
  customs: Parameters<typeof buildMcpJson>[4] = [],
) {
  return JSON.parse(buildMcpJson(knownServers, enabled, present, paramValues, customs)).mcpServers
}

describe('catalog servers', () => {
  // The point of the flag: switching a server off must not cost the user the
  // params they typed in.
  it('keeps a switched-off server, with its params, marked disabled', () => {
    const servers = build({ search: false }, { search: true }, { search: { 'X-Limit': '50' } })

    expect(servers.search).toEqual({
      type: 'http',
      url: 'https://search.example.com/mcp',
      disabled: true,
      headers: { 'X-Limit': '50' },
    })
  })

  it('leaves a server that was never added out of the config', () => {
    expect(build({ search: false }, { search: false })).toEqual({})
  })

  it('drops the flag when the server is switched back on', () => {
    const servers = build({ search: true }, { search: true })

    expect(servers.search.disabled).toBeUndefined()
  })

  it('reads a disabled entry back as present but off', () => {
    const raw = JSON.stringify({
      mcpServers: {
        search: {
          type: 'http',
          url: 'https://search.example.com/mcp',
          disabled: true,
          headers: { 'X-Limit': '50' },
        },
      },
    })

    const state = parseStructuredState(raw, knownServers, knownKeys)

    expect(state.enabled.search).toBe(false)
    expect(state.present.search).toBe(true)
    expect(state.paramValues.search['X-Limit']).toBe('50')
    expect(state.enabled.notes).toBe(false)
    expect(state.present.notes).toBe(false)
  })
})

describe('custom servers', () => {
  it('round-trips a disabled structured server', () => {
    const raw = JSON.stringify({
      mcpServers: {
        internal: {
          type: 'http',
          url: 'https://internal.example.com/mcp',
          headers: { Authorization: 'Bearer t' },
          disabled: true,
        },
      },
    })

    const state = parseStructuredState(raw, knownServers, knownKeys)
    expect(state.customs[0]).toMatchObject({ mode: 'struct', name: 'internal', disabled: true })

    const servers = build({}, {}, {}, state.customs)
    expect(servers.internal).toEqual({
      type: 'http',
      url: 'https://internal.example.com/mcp',
      headers: { Authorization: 'Bearer t' },
      disabled: true,
    })
  })

  // The flag is editor state, so a hand-written config keeps reading as its
  // own JSON rather than growing a field the user did not type.
  it('keeps the flag out of the JSON a raw server shows', () => {
    const raw = JSON.stringify({
      mcpServers: {
        odd: { type: 'sse', url: 'https://odd.example.com/mcp', disabled: true },
      },
    })

    const state = parseStructuredState(raw, knownServers, knownKeys)
    const draft = state.customs[0]

    expect(draft).toMatchObject({ mode: 'raw', disabled: true })
    expect(draft.mode === 'raw' && JSON.parse(draft.json).disabled).toBeUndefined()
    expect(build({}, {}, {}, [draft]).odd.disabled).toBe(true)
  })
})
