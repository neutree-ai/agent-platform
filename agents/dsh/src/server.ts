import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAcpAgentApp } from '../../../internal/acp-adapter/acp-server.js'
import { registerSkillRoutes } from '../../../internal/agent-skills/src/routes.js'
import { registerUsageRoutes } from '../../../internal/agent-usage/src/routes.js'
import { registerMcpForwardRoutes } from '../../../internal/mcp-forward/src/routes.js'
import {
  CP_URL,
  WORKSPACE_DIR,
  WORKSPACE_ID,
  captureSessionToken,
  cpAuthHeaders,
  getSkillManager,
  hasMcpServers,
  loadConfig,
  loadCredentials,
  loadRuntimeConfig,
  loadSkills,
} from './config.js'

let _restartBridge: (() => Promise<void>) | undefined

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Persist usage as JSONL under `$HOME/.acp-usage/<sessionId>.jsonl` for the
 * agent-usage sweeper — dsh keeps its sessions in its own JSONL log, which the
 * zero-dep sweeper does not parse.
 *
 * The figures are already per-turn totals: the bridge sums one usage record per
 * model request, so a tool-loop turn is counted in full rather than reporting
 * only its last request the way a response-level usage field would.
 */
function recordUsage(sessionId: string, usage: unknown): void {
  if (!usage || typeof usage !== 'object') return
  const u = usage as { inputTokens?: unknown; outputTokens?: unknown; cachedReadTokens?: unknown }
  const input = num(u.inputTokens)
  const output = num(u.outputTokens)
  if (input === 0 && output === 0) return
  const payload = {
    ts: new Date().toISOString(),
    model: loadRuntimeConfig()?.model || undefined,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: num(u.cachedReadTokens),
    total_tokens: input + output,
  }
  const dir = join(process.env.HOME ?? join(WORKSPACE_DIR, '.home'), '.acp-usage')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(payload)}\n`)
}

const { app, injectWebSocket, setBridgeFactory } = createAcpAgentApp({
  agentType: 'dsh',
  capabilities: {
    system_prompt: true,
    mcp: true,
    skills: false,
    questions: false,
    reconnect: true,
    // The SDK wire carries no approval request — server→client requests are
    // unimplemented on both ends — so the runtime runs unattended inside the
    // workspace pod, which is the isolation boundary.
    permissions: false,
    streaming_deltas: true,
  },
  keepFiles: new Set(['AGENTS.md', 'runtime.json']),
  workspaceDir: WORKSPACE_DIR,
  cpUrl: CP_URL,
  workspaceId: WORKSPACE_ID,
  // dsh takes its MCP servers from the generated composition, so this hook
  // exists only to receive the session token that composition needs.
  loadMcpServers: captureSessionToken,
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

registerSkillRoutes(app, '/skills', getSkillManager)

registerUsageRoutes(app, '/usage', {
  homeDir: process.env.HOME ?? join(WORKSPACE_DIR, '.home'),
  fallbackModel: () => loadRuntimeConfig()?.model,
})

registerMcpForwardRoutes(app, '/mcp', {
  cpUrl: CP_URL ?? '',
  authHeaders: cpAuthHeaders,
})

function setRestartBridge(fn: () => Promise<void>) {
  _restartBridge = fn
}

export { app, injectWebSocket, setBridgeFactory, setRestartBridge }
