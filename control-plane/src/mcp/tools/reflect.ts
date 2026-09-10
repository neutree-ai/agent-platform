import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getStoreById } from '../../services/db/memory'
import { getMessages } from '../../services/db/messages'
import { getSession, listSessions } from '../../services/db/sessions'
import { reflectWindow } from '../../services/reflect'
import { errorResult, textResult } from './shared'

const GET_ACTIVITY_DIGEST_MAX_SESSIONS = 10

/**
 * The only MCP tools registered for a Reflect turn (see mcp/tools.ts) —
 * everything else (bash, browser, sandbox, other MCP servers) a normal
 * workspace turn gets is deliberately withheld. `list_recent_activity`
 * decides its own bounded time window from the store's checkpoint so the
 * agent never has to compute or pass a timestamp itself.
 */
export function registerReflectTools(
  server: McpServer,
  workspaceId: string,
  storeId: string,
  sessionId: string,
) {
  server.registerTool(
    'list_recent_activity',
    {
      title: "List this workspace's sessions in this Reflect pass's window",
      description:
        "Lightweight metadata for sessions in this turn's catch-up window (oldest first), each with a preview of its first message. " +
        'Use `get_activity_digest` to read the full text of the ones that look relevant. ' +
        "If the tool result says more backlog remains, that's expected on a store with a large history — the next scheduled Reflect run continues from where this one leaves off, so there's no need to rush through everything in one pass.",
      inputSchema: z.object({
        limit: z.number().int().positive().max(200).optional().describe('Default 50.'),
      }),
    },
    async ({ limit }) => {
      const store = await getStoreById(storeId)
      if (!store) return errorResult(`Error: store ${storeId} not found`)
      const session = await getSession(sessionId)
      if (!session) return errorResult(`Error: session ${sessionId} not found`)

      const { since, until } = reflectWindow(store, session.created_at)
      const { items } = await listSessions(workspaceId, {
        activeAfter: since,
        activeBefore: until,
        order: 'asc', // oldest first: work through backlog chronologically
        excludeSources: ['schedule'], // exclude Reflect's own runs and other scheduled agents
        limit: limit ?? 50,
      })

      const remaining = new Date(until) < new Date()
      const header = `Window: ${since} to ${until}${remaining ? ' (more backlog remains after this window; a future scheduled run will continue)' : ' (caught up to now)'}`
      if (items.length === 0) return textResult(`${header}\n\nNo activity in this window.`)

      const lines = items.map((s) => {
        const preview = s.preview ? s.preview.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
        return `${s.id} | "${s.name || '(untitled)'}" | ${s.message_count}m | ${s.last_active_at}${preview ? `\n  ${preview}` : ''}`
      })
      return textResult(`${header}\n\n${lines.join('\n')}`)
    },
  )

  server.registerTool(
    'get_activity_digest',
    {
      title: 'Read the full text of specific sessions',
      description: `Full user/assistant text for up to ${GET_ACTIVITY_DIGEST_MAX_SESSIONS} sessions from \`list_recent_activity\`, concatenated inline. Tool calls, tool results, and thinking are stripped — only the conversational text. Batch related sessions in one call rather than calling once per id.`,
      inputSchema: z.object({
        session_ids: z
          .array(z.string())
          .min(1)
          .max(GET_ACTIVITY_DIGEST_MAX_SESSIONS)
          .describe(
            `Session ids from \`list_recent_activity\`. Up to ${GET_ACTIVITY_DIGEST_MAX_SESSIONS} per call.`,
          ),
      }),
    },
    async ({ session_ids }) => {
      const sections = await Promise.all(
        session_ids.map(async (id) => {
          const messages = await getMessages(workspaceId, id)
          if (messages.length === 0) {
            return `--- session ${id} ---\n(no messages found in this workspace)`
          }
          const body = messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n\n')
          return `--- session ${id} ---\n${body}`
        }),
      )
      return textResult(sections.join('\n\n'))
    },
  )
}
