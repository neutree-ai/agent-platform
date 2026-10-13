import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useCallback } from 'react'

import type { ComposerSendKey } from '@neutree-ai/ui-sdk'

const CHAT_SEND_KEYS: readonly ComposerSendKey[] = ['mod-enter', 'enter']
type ChatSendKey = ComposerSendKey
const DEFAULT_CHAT_SEND_KEY: ChatSendKey = 'mod-enter'

function isChatSendKey(v: unknown): v is ChatSendKey {
  return typeof v === 'string' && (CHAT_SEND_KEYS as readonly string[]).includes(v)
}

/**
 * User-level chat send-key preference, persisted on the fleet profile so the
 * choice follows the user across workspaces and devices.
 *
 * - `mod-enter` (default, current behavior): Cmd/Ctrl+Enter sends, Enter inserts newline
 * - `enter`: Enter sends, Shift+Enter / Cmd+Ctrl+Enter inserts newline (Slack-style)
 */
export function useChatSendKey(): {
  mode: ChatSendKey
  setMode: (m: ChatSendKey) => void
} {
  const payload = useWorkspaceProfile(FLEET_PROFILE_ID)
  const stored = (payload as { chatSendKey?: unknown }).chatSendKey
  const mode = isChatSendKey(stored) ? stored : DEFAULT_CHAT_SEND_KEY

  const setMode = useCallback((m: ChatSendKey) => {
    useWorkspaceProfileStore.getState().patch(FLEET_PROFILE_ID, { chatSendKey: m })
  }, [])

  return { mode, setMode }
}
