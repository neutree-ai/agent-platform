import { isComposing } from '@/lib/keyboard'
import { FLEET_PROFILE_ID } from '@/stores/fleet-profile'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useCallback } from 'react'

const CHAT_SEND_KEYS = ['mod-enter', 'enter'] as const
type ChatSendKey = (typeof CHAT_SEND_KEYS)[number]
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

/**
 * Returns true when the given keydown event should submit the chat input
 * under the supplied mode. Always returns false during IME composition so
 * Enter selecting a candidate (e.g. Chinese pinyin) never sends.
 */
export function shouldSubmitOnKey(
  e: React.KeyboardEvent | KeyboardEvent,
  mode: ChatSendKey,
): boolean {
  if (e.key !== 'Enter' || isComposing(e)) return false

  const withMod = e.metaKey || e.ctrlKey
  const withShift = e.shiftKey

  if (mode === 'mod-enter') {
    return withMod && !withShift
  }
  // mode === 'enter': plain Enter sends; Shift+Enter and Cmd/Ctrl+Enter insert newline.
  return !withMod && !withShift
}
