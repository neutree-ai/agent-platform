import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getStoreById } from '../../services/db/memory'
import { getMessages } from '../../services/db/messages'
import { listSessions } from '../../services/db/sessions'
import { errorResult, textResult } from './shared'

/** Never pull more than this far back, even for a store that has never been
 *  reflected on (last_reflected_at IS NULL) or was created long ago. */
const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

const GET_ACTIVITY_DIGEST_MAX_SESSIONS = 10

function sinceFor(store: { last_reflected_at: string | null; created_at: string }): string {
  const floor = new Date(Date.now() - MAX_LOOKBACK_MS)
  const checkpoint = new Date(store.last_reflected_at ?? store.created_at)
  return (checkpoint > floor ? checkpoint : floor).toISOString()
}

/**
 * The only MCP tools registered for a Reflect turn (see mcp/tools.ts) —
 * everything else (bash, browser, sandbox, other MCP servers) a normal
 * workspace turn gets is deliberately withheld. `list_recent_activity`
 * decides its own time window from the store's checkpoint so the agent never
 * has to compute or pass a timestamp itself.
 */
export function registerReflectTools(server: McpServer, workspaceId: string, storeId: string) {
  server.registerTool(
    'list_recent_activity',
    {
      title: "List this workspace's sessions since the last Reflect pass",
      description:
        "Lightweight metadata for sessions active since the last memory consolidation (or the store's creation, capped at 30 days back). " +
        'One line per session with a preview of its first message — use `get_activity_digest` to read the full text of the ones that look relevant.',
      inputSchema: z.object({
        limit: z.number().int().positive().max(200).optional().describe('Default 50.'),
      }),
    },
    async ({ limit }) => {
      const store = await getStoreById(storeId)
      if (!store) return errorResult(`Error: store ${storeId} not found`)

      const { items } = await listSessions(workspaceId, {
        activeAfter: sinceFor(store),
        excludeSources: ['schedule'], // exclude Reflect's own runs and other scheduled agents
        limit: limit ?? 50,
      })
      if (items.length === 0) return textResult('No activity since the last Reflect pass.')

      const lines = items.map((s) => {
        const preview = s.preview ? s.preview.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
        return `${s.id} | "${s.name || '(untitled)'}" | ${s.message_count}m | ${s.last_active_at}${preview ? `\n  ${preview}` : ''}`
      })
      return textResult(lines.join('\n'))
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
        session_ids.map(async (sessionId) => {
          const messages = await getMessages(workspaceId, sessionId)
          if (messages.length === 0) {
            return `--- session ${sessionId} ---\n(no messages found in this workspace)`
          }
          const body = messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n\n')
          return `--- session ${sessionId} ---\n${body}`
        }),
      )
      return textResult(sections.join('\n\n'))
    },
  )
}
