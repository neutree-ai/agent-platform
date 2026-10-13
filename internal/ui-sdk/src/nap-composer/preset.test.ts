import { describe, expect, it, vi } from 'vitest'
import { matchTrigger } from '../composer/text'
import type { ComposerTrigger, ComposerTriggerItem } from '../composer/types'
import type { NapComposerClient, NapDirEntry } from './client'
import { createNapComposerPreset, isNapBuiltinCommandSupported } from './preset'

const signal = new AbortController().signal

function trigger(client: NapComposerClient, id: string, workspaceId?: string): ComposerTrigger {
  const found = createNapComposerPreset({ client, workspaceId }).triggers.find((t) => t.id === id)
  if (!found) throw new Error(`no trigger ${id}`)
  return found
}

async function items(t: ComposerTrigger, query: string): Promise<ComposerTriggerItem[]> {
  return await t.getItems(query, signal)
}

describe('isNapBuiltinCommandSupported', () => {
  it('offers compact and goal only on cores that parse slash commands', () => {
    for (const core of ['claude-code', 'codex', 'goose']) {
      expect(isNapBuiltinCommandSupported('compact', core)).toBe(true)
      expect(isNapBuiltinCommandSupported('goal', core)).toBe(true)
    }
    expect(isNapBuiltinCommandSupported('compact', 'dsh')).toBe(false)
    expect(isNapBuiltinCommandSupported('goal', 'dsh')).toBe(false)
  })

  it('offers create-skill everywhere', () => {
    expect(isNapBuiltinCommandSupported('create-skill', 'dsh')).toBe(true)
  })
})

describe('createNapComposerPreset commands', () => {
  it('lists the built-ins, then app commands', () => {
    const preset = createNapComposerPreset({
      client: {},
      commands: [{ name: 'mine', type: 'plain', content: 'hi' }],
    })
    expect(preset.commands.map((c) => c.name)).toEqual(['compact', 'create-skill', 'goal', 'mine'])
  })

  it('drops built-ins the agent core cannot run', () => {
    const preset = createNapComposerPreset({ client: {}, agentType: 'dsh' })
    expect(preset.commands.map((c) => c.name)).toEqual(['create-skill'])
  })

  it('switches built-ins off individually or together', () => {
    expect(
      createNapComposerPreset({
        client: {},
        include: { builtinCommands: { goal: false } },
      }).commands.map((c) => c.name),
    ).toEqual(['compact', 'create-skill'])
    expect(
      createNapComposerPreset({ client: {}, include: { builtinCommands: false } }).commands,
    ).toEqual([])
  })

  it('loads enabled workspace commands, preferring prompt-library content', async () => {
    const preset = createNapComposerPreset({
      client: {
        listCommands: async () => [
          { name: 'a', type: 'plain', content: 'raw', prompt_id: 'p1', prompt_content: 'lib' },
          { name: 'b', type: 'struct', content: 'x {{y}}' },
          { name: 'c', type: 'plain', content: 'off', disabled: true },
        ],
      },
    })
    const loaded = await preset.loadCommands?.()
    expect(loaded?.map((c) => [c.name, c.type, c.content, !!c.icon])).toEqual([
      ['a', 'plain', 'lib', true],
      ['b', 'struct', 'x {{y}}', false],
    ])
  })

  it('leaves out sources that are switched off or unimplemented', () => {
    const preset = createNapComposerPreset({
      client: { listCommands: async () => [], transcribe: async () => '' },
      include: { workspaceCommands: false, voice: false },
    })
    expect(preset.loadCommands).toBeUndefined()
    expect(preset.voice).toBeUndefined()
    expect(preset.triggers).toEqual([])
  })
})

describe('@file trigger', () => {
  const fileTrigger = () => trigger({ listDir: async () => [] }, 'nap-file')

  it('matches a bare trigger and paths with spaces', () => {
    const { pattern } = fileTrigger()
    expect(matchTrigger(pattern, '@file/', 6)).toEqual({ start: 0, end: 6, query: '' })
    expect(matchTrigger(pattern, 'hello @file/foo', 15)).toEqual({
      start: 6,
      end: 15,
      query: 'foo',
    })
    expect(matchTrigger(pattern, '@file/报警 UI 优化/dra', 18)?.query).toBe('报警 UI 优化/dra')
  })

  it('binds to the last mention and stops at @ or newlines', () => {
    const { pattern } = fileTrigger()
    const two = '@file/a.md @file/b'
    expect(matchTrigger(pattern, two, two.length)).toEqual({ start: 11, end: 18, query: 'b' })
    expect(matchTrigger(pattern, two, 10)).toEqual({ start: 0, end: 10, query: 'a.md' })
    expect(matchTrigger(pattern, '@file/foo\nbar', 13)).toBeNull()
    expect(matchTrigger(pattern, '@file/a@b', 9)).toBeNull()
    expect(matchTrigger(pattern, '@file', 5)).toBeNull()
  })

  it('lists folders first, filters by name and builds insert text', async () => {
    const entries: NapDirEntry[] = [
      { name: 'readme.md', path_type: 'File' },
      { name: 'docs', path_type: 'Dir' },
      { name: 'notes.md', path_type: 'File' },
    ]
    const listDir = vi.fn(async () => entries)
    const t = trigger({ listDir }, 'nap-file')

    const root = await items(t, '')
    expect(listDir).toHaveBeenCalledWith('', '', signal)
    expect(root.map((i) => [i.key, i.insertText, !!i.keepOpen])).toEqual([
      ['docs', '@file/docs/', true],
      ['notes.md', '@file/notes.md ', false],
      ['readme.md', '@file/readme.md ', false],
    ])

    const nested = await items(t, 'docs/rea')
    expect(listDir).toHaveBeenLastCalledWith('docs', 'rea', signal)
    expect(nested.map((i) => i.insertText)).toEqual(['@file/docs/readme.md '])
    expect(t.header?.('docs/rea')).toBe('@file/docs/')
  })

  it('serves a repeated query from cache synchronously', async () => {
    const listDir = vi.fn(async () => [{ name: 'a', path_type: 'File' as const }])
    const t = trigger({ listDir }, 'nap-file')
    await items(t, '')
    const again = t.getItems('', signal)
    expect(Array.isArray(again)).toBe(true)
    expect(listDir).toHaveBeenCalledTimes(1)
  })

  it('narrows stale results by the entry name', async () => {
    const t = trigger(
      {
        listDir: async () => [
          { name: 'alpha', path_type: 'File' },
          { name: 'beta', path_type: 'File' },
        ],
      },
      'nap-file',
    )
    const all = await items(t, '')
    expect(t.narrow?.(all, 'be').map((i) => i.key)).toEqual(['beta'])
  })

  it('turns a failed listing into no items', async () => {
    const t = trigger({ listDir: async () => Promise.reject(new Error('boom')) }, 'nap-file')
    expect(await items(t, '')).toEqual([])
  })
})

describe('@ agent trigger', () => {
  const agents = [
    { id: 'self', slug: 'me', name: 'Me', owner: 'u', is_own: true },
    { id: 'w1', slug: 'writer', name: 'Writer', owner: 'u', is_own: true },
    { id: 'w2', slug: 'review', name: 'Reviewer', owner: 'team', is_own: false },
  ]
  const client: NapComposerClient = {
    listCallableAgents: async () => agents,
    listDir: async () => [],
  }

  it('matches bare @ and @agent/ but leaves @file/ to the file trigger', () => {
    const { pattern } = trigger(client, 'nap-agent')
    expect(matchTrigger(pattern, 'hi @wr', 6)?.query).toBe('wr')
    expect(matchTrigger(pattern, '@agent/team/re', 14)?.query).toBe('team/re')
    expect(matchTrigger(pattern, '@file/x', 7)).toBeNull()
  })

  it('offers the @file/ entry, then agents other than the current workspace', async () => {
    const t = trigger(client, 'nap-agent', 'self')
    const all = await items(t, '')
    expect(all.map((i) => i.insertText)).toEqual([
      '@file/',
      '@agent/writer ',
      '@agent/team/review ',
    ])
    expect(all[0].keepOpen).toBe(true)
    expect(all[2].meta).toBe('team')
  })

  it('filters agents by their reference', async () => {
    const t = trigger(client, 'nap-agent', 'self')
    expect((await items(t, 'team')).map((i) => i.insertText)).toEqual(['@agent/team/review '])
    expect((await items(t, 'fi')).map((i) => i.insertText)).toEqual(['@file/'])
  })

  it('offers only the @file/ entry when agents are switched off', async () => {
    const t = createNapComposerPreset({ client, include: { agents: false } }).triggers.find(
      (x) => x.id === 'nap-agent',
    )
    expect((await items(t as ComposerTrigger, '')).map((i) => i.insertText)).toEqual(['@file/'])
  })
})
