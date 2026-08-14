/**
 * Composition generation: one cordis config per session.
 *
 * A dsh runtime is a plugin tree described by a YAML config it boots with, so
 * everything the platform configures — the model route, the persona, the MCP
 * servers, where sessions persist — is expressed here rather than negotiated
 * over the wire. That works because one runtime process serves exactly one
 * session: composition time and session time are the same moment, which is
 * what lets a per-session MCP token ride a process-level config file.
 *
 * The file is written under the agent's own directory, not the workspace: it
 * carries the session's MCP credentials, and bare plugin names must resolve
 * against the agent's `node_modules`.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where generated compositions live; also the node resolution root for plugins. */
export const APP_DIR = process.env.DSH_APP_DIR || '/app'
const SESSIONS_CONFIG_DIR = join(APP_DIR, 'sessions')

export interface McpServerSpec {
  name: string
  /** HTTP servers carry the platform's per-session token in a header. */
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export interface CordisInputs {
  sessionId: string
  workspaceDir: string
  /** Persisted session logs; on the workspace volume so a restart can resume. */
  sessionRoot: string
  provider: {
    /** `openai-completions` or `anthropic-messages`. */
    api: string
    baseUrl: string
    model: string
    contextWindow?: number
    /** Name of the env var holding the key; never the key itself. */
    apiKeyEnv: string
  }
  mcpServers: McpServerSpec[]
}

/** YAML scalar for an arbitrary string. JSON's string form is valid YAML. */
function y(value: string): string {
  return JSON.stringify(value)
}

/** A `Key: value` block of plain string entries, or nothing when empty. */
function mapping(indent: string, entries: Record<string, string> | undefined): string[] {
  if (entries === undefined) return []
  return Object.entries(entries).map(([key, value]) => `${indent}${y(key)}: ${y(value)}`)
}

/**
 * dsh resolves a plugin's config at load, and the runtime serves one session,
 * so a per-session file is a per-session composition.
 */
export function renderCordisConfig(inputs: CordisInputs): string {
  const { provider } = inputs
  const lines: string[] = [
    '# Generated per session by the platform agent — edits are overwritten.',
    '# stdout carries JSON-RPC: never add a console logger to this tree.',
    '',
    '# The SDK server, patched to resume a session that already has a log.',
    '- id: sdk-jsonrpc-server',
    "  name: 'dsh-resume-server'",
    '  config:',
    '    maxTokensAsSuccess: true',
    '',
    "# The user's own model route. `apiKeyEnv` is a reference: the key itself",
    '# reaches the runtime through the environment, never this file.',
    '- id: llm',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    '    providers:',
    '      platform:',
    `        api: ${y(provider.api)}`,
    `        baseURL: ${y(provider.baseUrl)}`,
    `        apiKeyEnv: ${y(provider.apiKeyEnv)}`,
    '        models:',
    `          - id: ${y(provider.model)}`,
    ...(provider.contextWindow === undefined
      ? []
      : [`            contextWindow: ${provider.contextWindow}`]),
    '',
    '- id: subprocess',
    "  name: '@deepseek-ai/dsh-subprocess-local'",
    '',
    '- id: bash',
    "  name: '@deepseek-ai/dsh-bash-local'",
    '  config:',
    `    cwd: ${y(inputs.workspaceDir)}`,
    '    timeoutMs: 300000',
    '',
    '- id: fs-local',
    "  name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${y(inputs.workspaceDir)}`,
    '',
    '- id: fs-observation-policy',
    "  name: '@deepseek-ai/dsh-fs-observation-policy'",
    '',
    '- id: tool-fs',
    "  name: '@deepseek-ai/dsh-tool-fs'",
    '',
    '# The persona arrives by environment so this file stays free of user text.',
    '- id: agent-spine',
    "  name: '@deepseek-ai/dsh-agent-spine-demo'",
    '  config:',
    "    persona: !!js process.env.DSH_SYSTEM_PROMPT ?? 'You are a coding agent.'",
    '    workspaceContext: false',
    '    skills:',
    '      enabled: true',
    '',
    '# On the workspace volume, so a pod restart can still resume the session.',
    '- id: sessions',
    "  name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${y(inputs.sessionRoot)}`,
    '',
    '- id: session-checkpoints',
    "  name: '@deepseek-ai/dsh-session-checkpoint-policy'",
    '',
    '- id: subagent',
    "  name: '@deepseek-ai/dsh-subagent'",
    '',
    '- id: subagent-spawn-in-process',
    "  name: '@deepseek-ai/dsh-subagent-spawn-in-process'",
    '  config:',
    '    providerName: spawn',
    '',
    '- id: tool-subagent',
    "  name: '@deepseek-ai/dsh-tool-subagent'",
    '  config:',
    '    provider: spawn',
    '    toolName: subagent',
    '    enableRunInBackground: false',
    '',
    '- id: tool-todo',
    "  name: '@deepseek-ai/dsh-tool-todo'",
    '  config:',
    '    allowParallelInProgress: true',
    '',
    '- id: token-meter',
    "  name: '@deepseek-ai/dsh-token-meter'",
    '',
    '- id: compaction-basic',
    "  name: '@deepseek-ai/dsh-compaction-basic'",
    '  config:',
    '    thresholdRatio: 0.8',
    '    retainRatio: 0.16',
    '    maxTokens: 8192',
    '    compactionRetries: 1',
  ]

  // One plugin instance per MCP server; the model sees `mcp__<name>__<tool>`.
  inputs.mcpServers.forEach((server, index) => {
    lines.push('', `- id: mcp-${index}`, "  name: '@deepseek-ai/dsh-mcp-client'", '  config:')
    lines.push(`    serverName: ${y(server.name)}`)
    if (server.url !== undefined) {
      lines.push('    transport: streamable-http')
      lines.push(`    url: ${y(server.url)}`)
      if (server.headers && Object.keys(server.headers).length > 0) {
        lines.push('    headers:')
        lines.push(...mapping('      ', server.headers))
      }
    } else {
      lines.push('    transport: stdio')
      lines.push(`    command: ${y(server.command ?? '')}`)
      if (server.args?.length) {
        lines.push('    args:')
        lines.push(...server.args.map((arg) => `      - ${y(arg)}`))
      }
      if (server.env && Object.keys(server.env).length > 0) {
        lines.push('    env:')
        lines.push(...mapping('      ', server.env))
      }
    }
  })

  return `${lines.join('\n')}\n`
}

/** Write the session's composition and return its path. */
export function writeCordisConfig(inputs: CordisInputs): string {
  const dir = join(SESSIONS_CONFIG_DIR, inputs.sessionId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'cordis.yml')
  writeFileSync(path, renderCordisConfig(inputs), { mode: 0o600 })
  return path
}
