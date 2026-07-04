import { describe, expect, it } from 'vitest'
import type { ChatBody } from '../../../../internal/types/api'
import { buildAgentChatBody, buildUserMessageBlocks, resolveChatMode } from './request'

const img = { data: 'aGk=', media_type: 'image/png' }

describe('buildAgentChatBody', () => {
  it('new session: omits session_id entirely (agent creates the session)', () => {
    const body = buildAgentChatBody({
      message: 'hi',
      sessionId: null,
      images: null,
      source: 'web',
      sessionToken: 'tok',
    })
    expect(body).toEqual({ message: 'hi', source: 'web', session_token: 'tok' })
    expect('session_id' in body).toBe(false)
    expect('images' in body).toBe(false)
  })

  it('resume: carries session_id', () => {
    const body = buildAgentChatBody({
      message: 'hi',
      sessionId: 's1',
      images: null,
      source: 'schedule',
      sessionToken: 'tok',
    })
    expect(body).toEqual({
      message: 'hi',
      session_id: 's1',
      source: 'schedule',
      session_token: 'tok',
    })
  })

  it('includes images only when non-empty', () => {
    const withImages = buildAgentChatBody({
      message: 'hi',
      sessionId: 's1',
      images: [img],
      source: 'web',
      sessionToken: 'tok',
    })
    expect(withImages.images).toEqual([img])

    const emptyImages = buildAgentChatBody({
      message: 'hi',
      sessionId: 's1',
      images: [],
      source: 'web',
      sessionToken: 'tok',
    })
    expect('images' in emptyImages).toBe(false)
  })
})

describe('buildUserMessageBlocks', () => {
  it('text only → single text block', () => {
    expect(buildUserMessageBlocks('hello', null)).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('text first, then one image block per attachment', () => {
    expect(buildUserMessageBlocks('hello', [img, img])).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', data: img.data, media_type: img.media_type },
      { type: 'image', data: img.data, media_type: img.media_type },
    ])
  })
})

describe('resolveChatMode', () => {
  const body = (b: Partial<ChatBody>) => ({ message: 'hi', source: 'web', ...b }) as ChatBody

  it('explicit mode wins over everything', () => {
    expect(resolveChatMode(body({ mode: 'async', stream: true }), 'application/json')).toBe('async')
    expect(resolveChatMode(body({ mode: 'sync', stream: true }), undefined)).toBe('sync')
  })

  it('legacy stream flag: false → sync, true → stream (beats Accept)', () => {
    expect(resolveChatMode(body({ stream: false }), undefined)).toBe('sync')
    expect(resolveChatMode(body({ stream: true }), 'application/json')).toBe('stream')
  })

  it('Accept: application/json → sync when nothing else is set', () => {
    expect(resolveChatMode(body({}), 'application/json')).toBe('sync')
    expect(resolveChatMode(body({}), 'text/html, application/json')).toBe('sync')
  })

  it('default → stream', () => {
    expect(resolveChatMode(body({}), undefined)).toBe('stream')
    expect(resolveChatMode(body({}), 'text/event-stream')).toBe('stream')
  })
})
