import { afterEach, describe, expect, it, vi } from 'vitest'
import { NapClient } from '../../../internal/client/src/index'
import {
  appendAttachmentPaths,
  extractSlackText,
  genericSlackFiles,
  slackAttachmentPath,
  stageGenericFiles,
} from './slack'

afterEach(() => vi.unstubAllGlobals())

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

describe('generic Slack attachments', () => {
  it('keeps generic files out of the image and audio paths', () => {
    expect(
      genericSlackFiles([
        { id: 'F1', name: 'report.pdf', mimetype: 'application/pdf' },
        { id: 'F2', name: 'photo.png', mimetype: 'image/png' },
        { id: 'F3', name: 'voice.m4a', mimetype: 'audio/mp4' },
      ]),
    ).toEqual([{ id: 'F1', name: 'report.pdf', mimetype: 'application/pdf' }])
  })

  it('uses a safe, deterministic workspace path', () => {
    expect(slackAttachmentPath({ id: 'F/1', name: '../report.pdf' })).toBe(
      '.attachments/slack/F_1/_report.pdf',
    )
  })

  it('tells the agent about staged paths and download failures', () => {
    expect(
      appendAttachmentPaths(
        'summarize these',
        ['.attachments/slack/F1/report.pdf'],
        ['missing.csv — attachment download failed: 403'],
      ),
    ).toBe(
      'summarize these\n<attachments>\n- /workspace/.attachments/slack/F1/report.pdf\n- missing.csv — attachment download failed: 403\n</attachments>',
    )
  })

  it('streams a downloaded file through the route-owner client', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://slack.test/report') {
        calls.push('download')
        return new Response('report body')
      }
      calls.push('write')
      expect(String(url)).toBe(
        'https://nap.test/api/workspaces/ws1/agent/files?path=.attachments%2Fslack%2FF1%2Freport.pdf',
      )
      expect(init?.body).toBeInstanceOf(ReadableStream)
      expect((init as RequestInit & { duplex?: string }).duplex).toBe('half')
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer route-owner-token',
        'Content-Type': 'application/pdf',
      })
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await stageGenericFiles(
      [
        {
          id: 'F1',
          name: 'report.pdf',
          mimetype: 'application/pdf',
          url_private: 'https://slack.test/report',
        },
      ],
      new NapClient({ baseUrl: 'https://nap.test', serviceToken: 'route-owner-token' }),
      'ws1',
      'xoxb-test',
    )

    expect(result).toEqual({ paths: ['.attachments/slack/F1/report.pdf'], failures: [] })
    expect(calls).toEqual(['download', 'write'])
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://slack.test/report', {
      headers: { Authorization: 'Bearer xoxb-test' },
    })
  })

  it('reports download failures without attempting a workspace write', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      stageGenericFiles(
        [{ id: 'F1', name: 'report.pdf', url_private: 'https://slack.test/report' }],
        new NapClient({ baseUrl: 'https://nap.test', serviceToken: 'route-owner-token' }),
        'ws1',
        'xoxb-test',
      ),
    ).resolves.toEqual({
      paths: [],
      failures: ['report.pdf — attachment download failed: 403'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces workspace staging errors and does not hide the 503 message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('report body'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Workspace is stopped and auto-start is disabled' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      stageGenericFiles(
        [{ id: 'F1', name: 'report.pdf', url_private: 'https://slack.test/report' }],
        new NapClient({ baseUrl: 'https://nap.test', serviceToken: 'route-owner-token' }),
        'ws1',
        'xoxb-test',
      ),
    ).rejects.toThrow('Workspace is stopped and auto-start is disabled')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
