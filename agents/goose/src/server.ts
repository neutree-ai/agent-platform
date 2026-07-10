import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAcpAgentApp } from '../../../internal/acp-adapter/acp-server.js'
import { registerSkillRoutes } from '../../../internal/agent-skills/src/routes.js'
import { registerUsageRoutes } from '../../../internal/agent-usage/src/routes.js'
import {
  CP_URL,
  WORKSPACE_DIR,
  WORKSPACE_ID,
  getSkillManager,
  hasMcpServers,
  loadAcpMcpServers,
  loadConfig,
  loadCredentials,
  loadRuntimeConfig,
  loadSkills,
} from './config.js'
import { sessionIdMap } from './session-id-map.js'

let _restartBridge: (() => Promise<void>) | undefined

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Latest session-accumulated token counters, keyed by NATIVE goose session id
 * (ext notifications carry native ids). Fed by trackExtNotification; read at
 * turn end by recordUsage. These counters — not PromptResponse.usage — are
 * the accurate billing source: the response usage only reflects the turn's
 * last LLM request, so tool-loop turns undercount 2×+.
 */
const accumulatedUsage = new Map<string, { input: number; output: number }>()

export function trackExtNotification(method: string, params: Record<string, unknown>): void {
  if (method !== '_goose/unstable/session/update') return
  const sessionId = params.sessionId
  const update = params.update as Record<string, unknown> | undefined
  if (typeof sessionId !== 'string' || update?.sessionUpdate !== 'usage_update') return
  const input = num(update.accumulatedInputTokens)
  const output = num(update.accumulatedOutputTokens)
  if (input === 0 && output === 0) return
  accumulatedUsage.set(sessionId, { input, output })
}

/**
 * Persist usage as JSONL under $HOME/.acp-usage/<sessionId>.jsonl
 * (PVC-durable) — goose keeps its sessions in SQLite, which the zero-dep
 * agent-usage sweeper can't read. One line per completed turn; the sweeper's
 * parseAcpUsageLog turns lines into ledger records idempotently.
 *
 * Preferred line shape carries the session-accumulated counters (parser
 * emits per-line deltas, codex-style, so the file is restart-safe); when no
 * ext notification was seen for the session, fall back to the per-turn
 * PromptResponse.usage shape (undercounts multi-request turns, better than
 * nothing).
 */
function recordUsage(sessionId: string, usage: unknown): void {
  const nativeId = sessionIdMap().decode(sessionId)
  const acc = accumulatedUsage.get(nativeId)
  const model = loadRuntimeConfig()?.model || undefined
  let payload: Record<string, unknown> | null = null
  if (acc) {
    payload = {
      ts: new Date().toISOString(),
      model,
      accumulated_input_tokens: acc.input,
      accumulated_output_tokens: acc.output,
    }
  } else if (usage && typeof usage === 'object') {
    const u = usage as {
      inputTokens?: unknown
      outputTokens?: unknown
      totalTokens?: unknown
    }
    const input = num(u.inputTokens)
    const output = num(u.outputTokens)
    if (input === 0 && output === 0) return
    payload = {
      ts: new Date().toISOString(),
      model,
      input_tokens: input,
      output_tokens: output,
      total_tokens: num(u.totalTokens) || input + output,
    }
  }
  if (!payload) return
  const dir = join(process.env.HOME ?? join(WORKSPACE_DIR, '.home'), '.acp-usage')
  mkdirSync(dir, { recursive: true })
  // Session ids are platform UUIDs — safe as filenames.
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(payload)}\n`)
}

const { app, injectWebSocket, setBridgeFactory } = createAcpAgentApp({
  agentType: 'goose',
  // One goose child serves every session (ACP multiplexes sessions natively;
  // per-session MCP token isolation within one process is verified). Critical
  // here because goose persists sessions in a WAL-mode SQLite on the
  // workspace volume (typically NFS) — per-session child processes would be
  // N concurrent SQLite writers on a network filesystem, the exact setup
  // SQLite documents as unsafe. Single child = single writer.
  bridgeMode: 'shared',
  capabilities: {
    system_prompt: true,
    mcp: true,
    skills: false,
    questions: false,
    reconnect: true,
    permissions: true,
    streaming_deltas: true,
  },
  keepFiles: new Set(['AGENTS.md', 'runtime.json']),
  workspaceDir: WORKSPACE_DIR,
  cpUrl: CP_URL,
  workspaceId: WORKSPACE_ID,
  loadMcpServers: loadAcpMcpServers,
  hasMcpServers: () => hasMcpServers,
  loadConfig,
  loadSkills,
  loadCredentials,
  restartBridge: () => {
    if (!_restartBridge) throw new Error('restartBridge not set')
    return _restartBridge()
  },
  recordUsage,
})

// Skill management routes
registerSkillRoutes(app, '/skills', getSkillManager)

// Token-usage pull endpoint. Sweeps leftover .claude/.codex transcripts
// (core-switch history) plus $HOME/.acp-usage/*.jsonl — the per-turn records
// appended by `recordUsage` above, which is how goose usage reaches the
// ledger (its own SQLite session store isn't parseable by the zero-dep
// sweeper).
registerUsageRoutes(app, '/usage', {
  homeDir: process.env.HOME ?? join(WORKSPACE_DIR, '.home'),
  fallbackModel: () => loadRuntimeConfig()?.model,
})

function setRestartBridge(fn: () => Promise<void>) {
  _restartBridge = fn
}

export { app, injectWebSocket, setBridgeFactory, setRestartBridge }
