import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createAgentRequest,
  getAgentRequest,
  markAgentRequestApplied,
} from '../../../services/db/agent-requests'
import { getWorkspace } from '../../../services/db/workspaces'
import { textResult } from '../shared'

/**
 * A single Builder Mode action: one business operation that uses the
 * agent_request human-in-loop primitive. Each action expands into a pair of
 * MCP tools (`workspace_<resource>_propose` and `workspace_<resource>_apply`)
 * sharing the same payload type — propose writes a pending row, apply
 * consumes the row after the user approves.
 *
 * `apply` returns a human-readable text the agent shows the user (typically
 * "<resource> created" or similar). It runs only after status=approved and
 * with payload already re-parsed through the same zod schema propose used.
 */
interface BuilderAction<P> {
  /** kind tag persisted on the `agent_requests` row. */
  kind: string
  /**
   * Tool-naming scope.
   *  - `workspace` (default): tools are `workspace_<resource>_propose` / `_apply`.
   *  - `global`: tools are `<resource>_propose` / `_apply` (no prefix), used for
   *    account-scoped resources like the user prompt library.
   */
  scope?: 'workspace' | 'global'
  /** Used to derive tool names — see `scope`. */
  resource: string
  /** Zod schema for the action payload — single source of truth across propose/apply. */
  payload: z.ZodType<P>
  /**
   * Static one-line action label embedded in the tool_result envelope, e.g.
   * "Create schedule". Rich payload rendering lives in the web per-kind body
   * renderer; this is just enough for the agent and a no-body fallback chrome.
   */
  label: string
  /** MCP tool description for the propose tool. apply description is generated. */
  proposeDescription: string
  /** Apply implementation. Returns text the agent uses as its tool_result. */
  apply: (ctx: { workspaceId: string; userId: string; payload: P }) => Promise<string>
}

/** Identity helper so callers get inference for `P` from the zod schema. */
export function defineBuilderAction<P>(action: BuilderAction<P>): BuilderAction<P> {
  return action
}

/**
 * Register the propose + apply MCP tool pair for one Builder Mode action.
 * Generic error handling (workspace lookup, kind mismatch, status checks,
 * payload reparse) lives here so each action stays focused on its business
 * logic in `apply`.
 */
export function registerBuilderAction<P>(
  server: McpServer,
  workspaceId: string,
  action: BuilderAction<P>,
): void {
  const prefix = action.scope === 'global' ? '' : 'workspace_'
  const proposeTool = `${prefix}${action.resource}_propose`
  const applyTool = `${prefix}${action.resource}_apply`

  server.registerTool(
    proposeTool,
    {
      title: `Propose ${action.resource}`,
      description: action.proposeDescription,
      inputSchema: action.payload as z.ZodType<P>,
    },
    async (raw) => {
      try {
        const payload = action.payload.parse(raw)
        const workspace = await getWorkspace(workspaceId)
        if (!workspace) return textResult('Error: workspace not found')

        const req = await createAgentRequest({
          workspace_id: workspaceId,
          user_id: workspace.user_id,
          kind: action.kind,
          payload: payload as Record<string, unknown>,
        })

        return textResult(
          JSON.stringify({
            request_id: req.id,
            kind: req.kind,
            label: action.label,
            payload: payload,
            status: 'pending',
          }),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )

  server.registerTool(
    applyTool,
    {
      title: `Apply approved ${action.resource} request`,
      description: `Finalize a \`${proposeTool}\` request that the user has approved. Pass the \`request_id\` returned by the propose tool.`,
      inputSchema: z.object({
        request_id: z.string().describe('The agent_request id from the propose step.'),
      }),
    },
    async ({ request_id }) => {
      try {
        const req = await getAgentRequest(request_id)
        if (!req || req.workspace_id !== workspaceId) {
          return textResult('Error: request not found')
        }
        if (req.kind !== action.kind) {
          return textResult(`Error: request kind mismatch (got "${req.kind}")`)
        }
        if (req.status !== 'approved') {
          return textResult(`Error: request is "${req.status}", not approved`)
        }

        // CAS approved → applied before running business effect, so concurrent
        // apply calls race here and only one wins.
        const claimed = await markAgentRequestApplied(request_id)
        if (!claimed) {
          return textResult('Error: request is no longer approved (already applied?)')
        }

        const payload = action.payload.parse(req.payload)
        const result = await action.apply({ workspaceId, userId: req.user_id, payload })
        return textResult(result)
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}
