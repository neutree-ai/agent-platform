/**
 * `withImageUrls` is what keeps a long session's message payload small: image
 * blocks are the bulk of stored transcript bytes, so history serves them by URL
 * instead of inlining base64. The ordinal in that URL must match the block's
 * position, because the serving route resolves it straight to the event id.
 */
import { describe, expect, it } from 'vitest'
import { withImageUrls } from '../workspaces/_image-blocks'

const IMAGE = { type: 'image', media_type: 'image/png', data: 'aGVsbG8=' }

describe('withImageUrls', () => {
  it('replaces inline base64 with a URL addressing the block position', () => {
    const blocks = withImageUrls('ws-1', 'msg-1', [{ type: 'text', text: 'hi' }, IMAGE]) as any[]

    expect(blocks[0]).toEqual({ type: 'text', text: 'hi' })
    expect(blocks[1]).toEqual({
      type: 'image',
      media_type: 'image/png',
      url: '/api/workspaces/ws-1/messages/msg-1/blocks/1/image',
    })
    expect(blocks[1]).not.toHaveProperty('data')
  })

  it('numbers each image by its own position, not by image count', () => {
    const blocks = withImageUrls('ws-1', 'msg-1', [
      IMAGE,
      { type: 'text', text: 'between' },
      IMAGE,
    ]) as any[]

    expect(blocks[0].url).toBe('/api/workspaces/ws-1/messages/msg-1/blocks/0/image')
    expect(blocks[2].url).toBe('/api/workspaces/ws-1/messages/msg-1/blocks/2/image')
  })

  it('escapes ids so they cannot break out of the path', () => {
    const blocks = withImageUrls('ws/../other', 'msg 1', [IMAGE]) as any[]

    expect(blocks[0].url).toBe('/api/workspaces/ws%2F..%2Fother/messages/msg%201/blocks/0/image')
  })

  it('leaves image blocks that carry no inline data untouched', () => {
    const alreadyByUrl = { type: 'image', media_type: 'image/png', url: '/elsewhere' }

    expect(withImageUrls('ws-1', 'msg-1', [alreadyByUrl])).toEqual([alreadyByUrl])
  })

  it('passes through a non-array blocks value', () => {
    expect(withImageUrls('ws-1', 'msg-1', null)).toBeNull()
  })
})
