import type { ChatMessage } from '@/stores/agent-session-store'
import { describe, expect, it } from 'vitest'
import { searchMessages } from './search-utils'

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  blocks?: ChatMessage['blocks'],
): ChatMessage {
  return {
    id,
    role,
    content,
    blocks: blocks ?? (role === 'user' ? [] : [{ type: 'text', text: content }]),
  }
}

describe('searchMessages', () => {
  it('returns empty for empty query', () => {
    const messages = [msg('1', 'user', 'hello world')]
    expect(searchMessages(messages, '')).toEqual([])
    expect(searchMessages(messages, '   ')).toEqual([])
  })

  it('finds matches in user content', () => {
    const messages = [msg('1', 'user', 'Hello World')]
    const matches = searchMessages(messages, 'hello')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ messageId: '1', globalIndex: 0 })
  })

  it('finds matches in assistant text blocks', () => {
    const messages = [
      msg('1', 'assistant', '', [
        { type: 'text', text: 'The quick brown fox' },
        { type: 'tool', tool: { id: 't1', name: 'test', input: {}, content: '' } },
        { type: 'text', text: 'jumps over the fox' },
      ]),
    ]
    const matches = searchMessages(messages, 'fox')
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({ messageId: '1', globalIndex: 0 })
    expect(matches[1]).toEqual({ messageId: '1', globalIndex: 1 })
  })

  it('finds multiple matches in one text', () => {
    const messages = [msg('1', 'user', 'foo bar foo baz foo')]
    const matches = searchMessages(messages, 'foo')
    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.messageId === '1')).toBe(true)
    expect(matches.map((m) => m.globalIndex)).toEqual([0, 1, 2])
  })

  it('is case-insensitive', () => {
    const messages = [msg('1', 'user', 'Hello HELLO hello')]
    expect(searchMessages(messages, 'HELLO')).toHaveLength(3)
  })

  it('tracks globalIndex across messages', () => {
    const messages = [
      msg('1', 'user', 'one match here'),
      msg('2', 'assistant', '', [{ type: 'text', text: 'another match and match' }]),
    ]
    const matches = searchMessages(messages, 'match')
    expect(matches).toHaveLength(3)
    expect(matches[0]).toEqual({ messageId: '1', globalIndex: 0 })
    expect(matches[1]).toEqual({ messageId: '2', globalIndex: 1 })
    expect(matches[2]).toEqual({ messageId: '2', globalIndex: 2 })
  })

  it('returns empty for no matches', () => {
    const messages = [msg('1', 'user', 'hello world')]
    expect(searchMessages(messages, 'xyz')).toEqual([])
  })
})
