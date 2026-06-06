import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const webFetchTool = tool(
  'web_fetch',
  'Fetch a web page and return its content as clean markdown. Use this to read articles, documentation, or any web page.',
  { url: z.string().url().describe('The URL of the web page to fetch') },
  async ({ url }) => {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/markdown' },
    })
    if (!resp.ok) {
      return {
        content: [
          { type: 'text' as const, text: `Failed to fetch: ${resp.status} ${resp.statusText}` },
        ],
        isError: true,
      }
    }
    const text = await resp.text()
    return { content: [{ type: 'text' as const, text }] }
  },
  { annotations: { readOnlyHint: true, openWorldHint: true } },
)

export const jinaServer = createSdkMcpServer({
  name: 'web-fetch',
  tools: [webFetchTool],
})
