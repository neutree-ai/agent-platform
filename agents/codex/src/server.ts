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

let _restartBridge: (() => Promise<void>) | undefined

const { app, injectWebSocket, setBridgeFactory } = createAcpAgentApp({
  agentType: 'codex',
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
})

// Skill management routes
registerSkillRoutes(app, '/skills', getSkillManager)

// Token-usage pull endpoint — cp pulls per-turn token records read from the
// on-disk transcripts. The reader scans BOTH .codex and .claude (a workspace
// switched between cores keeps the other core's transcripts on its PVC), so
// every agent passes its workspace model as the fallback for records that omit
// one (codex rollouts do). See internal/agent-usage.
registerUsageRoutes(app, '/usage', {
  homeDir: process.env.HOME ?? join(WORKSPACE_DIR, '.home'),
  fallbackModel: () => loadRuntimeConfig()?.model,
})

function setRestartBridge(fn: () => Promise<void>) {
  _restartBridge = fn
}

export { app, injectWebSocket, setBridgeFactory, setRestartBridge }
