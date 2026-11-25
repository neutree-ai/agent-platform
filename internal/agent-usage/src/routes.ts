/**
 * Usage pull endpoint, framework-agnostic (no Hono dependency — caller mounts
 * on its own app, same pattern as agent-skills/routes.ts).
 *
 *   import { registerUsageRoutes } from '.../agent-usage/src/routes.js'
 *   registerUsageRoutes(app, '/usage', { homeDir: process.env.HOME! })
 *
 * Pull model: control-plane POSTs its last cursor, the agent sweeps the (PVC,
 * durable) transcripts and returns new records + the updated cursor. The agent
 * holds no state — cursor + ledger live in cp, so a disconnect only delays
 * ingestion, never loses it, and re-pulls are idempotent (ledger dedups).
 */

import { type SweepCursors, sweepUsage } from './node.js'

interface RouteApp {
  post(path: string, handler: (c: any) => any): void
}

export interface UsageRouteDeps {
  /** Agent HOME; transcripts under $HOME/.claude and $HOME/.codex. */
  homeDir: string
  /**
   * Returns the workspace's configured model, used as the fallback for
   * transcript records that omit their own (codex rollouts do; claude doesn't).
   * A getter so config reloads are reflected at pull time.
   */
  fallbackModel?: () => string | undefined
}

/**
 * Mount the usage pull route:
 *   POST <prefix>   body: { cursors?, maxFiles? } → { records, cursors, hasMore }
 *
 * The caller (cp) passes its persisted `cursors` and an optional `maxFiles` cap;
 * when `hasMore` comes back true it pulls again to drain the rest (bounds the
 * per-call work for large backlogs).
 *
 * One sweep runs at a time. A pull that arrives while one is in flight gets 503
 * and is retried by the caller later: every sweep stats the whole transcript
 * tree, so letting pulls stack up (the caller may give up and pull again before
 * a slow sweep finishes) would multiply that load without returning anything
 * the next pull cannot.
 */
export function registerUsageRoutes(app: RouteApp, prefix: string, deps: UsageRouteDeps): void {
  let sweeping = false
  app.post(`${prefix}`, async (c: any) => {
    if (sweeping) return c.json({ error: 'usage sweep already in progress' }, 503)
    sweeping = true
    try {
      return await handlePull(c, deps)
    } finally {
      sweeping = false
    }
  })
}

async function handlePull(c: any, deps: UsageRouteDeps) {
  let cursors: SweepCursors | undefined
  let maxFiles: number | undefined
  try {
    const body = await c.req.json()
    cursors = body?.cursors
    maxFiles = typeof body?.maxFiles === 'number' ? body.maxFiles : undefined
  } catch {
    cursors = undefined // empty body → full sweep
  }
  try {
    const result = await sweepUsage({
      homeDir: deps.homeDir,
      cursors,
      maxFiles,
      fallbackModel: deps.fallbackModel?.(),
    })
    return c.json(result)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
}
