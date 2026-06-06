import { describe, expect, test } from 'vitest'
import { renderPlatformPrompt } from './index.ts'

describe('renderPlatformPrompt', () => {
  test('claude-code with userName', () => {
    expect(
      renderPlatformPrompt({
        agentKind: 'claude-code',
        workspaceId: 'ws-abc',
        userName: 'Alice',
      }),
    ).toMatchSnapshot()
  })

  test('claude-code without userName', () => {
    expect(
      renderPlatformPrompt({ agentKind: 'claude-code', workspaceId: 'ws-abc' }),
    ).toMatchSnapshot()
  })

  test('codex with userName', () => {
    expect(
      renderPlatformPrompt({ agentKind: 'codex', workspaceId: 'ws-abc', userName: 'Alice' }),
    ).toMatchSnapshot()
  })

  test('missing workspaceId falls back to "unknown"', () => {
    const out = renderPlatformPrompt({ agentKind: 'claude-code', workspaceId: undefined })
    expect(out).toContain('id: unknown')
  })
})
