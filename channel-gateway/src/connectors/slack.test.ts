import { describe, expect, it } from 'vitest'
import { extractSlackText } from './slack'

describe('extractSlackText', () => {
  it('returns text when present', () => {
    expect(extractSlackText({ text: 'hello world' })).toBe('hello world')
  })

  it('returns empty string when all fields absent', () => {
    expect(extractSlackText({})).toBe('')
  })

  it('returns empty string when text is empty string', () => {
    expect(extractSlackText({ text: '' })).toBe('')
  })

  describe('attachments fallback', () => {
    it('falls back to attachments when text is empty', () => {
      const msg = {
        text: '',
        attachments: [{ pretext: 'pre', title: 'title', text: 'body', fallback: 'fb' }],
      }
      expect(extractSlackText(msg)).toBe('pre title body fb')
    })

    it('skips null/undefined attachment fields', () => {
      const msg = {
        text: '',
        attachments: [{ text: 'only body' }],
      }
      expect(extractSlackText(msg)).toBe('only body')
    })

    it('joins multiple attachments with newlines', () => {
      const msg = {
        text: '',
        attachments: [{ text: 'first' }, { text: 'second' }],
      }
      expect(extractSlackText(msg)).toBe('first\nsecond')
    })

    it('does not fall back to attachments when text is non-empty', () => {
      const msg = {
        text: 'real text',
        attachments: [{ text: 'attachment body' }],
      }
      expect(extractSlackText(msg)).toBe('real text')
    })
  })

  describe('blocks fallback', () => {
    it('falls back to blocks when text and attachments are both empty', () => {
      const msg = {
        text: '',
        blocks: [
          { type: 'rich_text', text: { text: 'block one' } },
          { type: 'rich_text', text: { text: 'block two' } },
        ],
      }
      expect(extractSlackText(msg)).toBe('block one\nblock two')
    })

    it('skips blocks without text', () => {
      const msg = {
        text: '',
        blocks: [{ type: 'divider' }, { type: 'rich_text', text: { text: 'content' } }],
      }
      expect(extractSlackText(msg)).toBe('content')
    })

    it('does not fall back to blocks when attachments already provided text', () => {
      const msg = {
        text: '',
        attachments: [{ text: 'from attachment' }],
        blocks: [{ type: 'rich_text', text: { text: 'from block' } }],
      }
      expect(extractSlackText(msg)).toBe('from attachment')
    })

    it('handles the @bot-in-thread Block Kit scenario (text is only the mention)', () => {
      // After mention-stripping this becomes empty, but the caller strips — here we
      // verify that a message where Slack puts content in blocks is extracted correctly.
      const msg = {
        text: '<@U0AGMD5K475>',
        blocks: [
          {
            type: 'rich_text',
            elements: [],
            text: { text: 'please summarize this document' },
          },
        ],
      }
      // text is non-empty (the raw mention), so extractSlackText returns it as-is.
      // The caller strips the mention; after stripping, it re-calls with the event
      // which still has blocks. This test documents current behaviour: text wins.
      // The real fix is that after stripping the mention, if cleanText is empty,
      // the caller should fall back — modelled by the next test.
      expect(extractSlackText(msg)).toBe('<@U0AGMD5K475>')
    })

    it('extracts from blocks when text is only whitespace after trimming', () => {
      // Simulates: text contained only the bot mention, which was stripped to ''
      // Then the caller re-invokes extractSlackText with the original event but
      // an overridden text — or simply the blocks path applies on the first call
      // when text is genuinely empty (some Slack clients omit text entirely for
      // rich-text messages and put everything in blocks).
      const msg = {
        text: '',
        blocks: [{ type: 'rich_text', text: { text: 'please summarize this document' } }],
      }
      expect(extractSlackText(msg)).toBe('please summarize this document')
    })
  })
})
