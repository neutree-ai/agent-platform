import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DraftState {
  drafts: Record<string, string>
  setDraft: (key: string, value: string) => void
  clearDraft: (key: string) => void
}

function draftKey(workspaceId: string, sessionId: string | undefined): string {
  return `${workspaceId}:${sessionId ?? '__new__'}`
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (key, value) => set((s) => ({ drafts: { ...s.drafts, [key]: value } })),
      clearDraft: (key) =>
        set((s) => {
          const { [key]: _, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    { name: 'tos-chat-drafts' },
  ),
)

/** Imperative read of a composer draft (for non-React callers). */
export function getDraftFor(workspaceId: string, sessionId: string | undefined): string {
  return useDraftStore.getState().drafts[draftKey(workspaceId, sessionId)] ?? ''
}

/** Imperative clear of a composer draft (for non-React callers). */
export function clearDraftFor(workspaceId: string, sessionId: string | undefined): void {
  useDraftStore.getState().clearDraft(draftKey(workspaceId, sessionId))
}

/**
 * Re-key a composer draft from one session slot to another (for non-React
 * callers). Used when a brand-new session finally gets its id: a draft armed
 * under the `__new__` slot before `session.started` arrived must follow the
 * session to its real-id slot, or the draft-clear on drain — which keys off the
 * real id — would miss it and the composer would surface stale text. No-op when
 * the source slot is empty; overwrites the target slot when it isn't.
 */
export function migrateDraft(
  workspaceId: string,
  fromSessionId: string | undefined,
  toSessionId: string | undefined,
): void {
  const fromKey = draftKey(workspaceId, fromSessionId)
  const toKey = draftKey(workspaceId, toSessionId)
  if (fromKey === toKey) return
  const store = useDraftStore.getState()
  const value = store.drafts[fromKey]
  if (value === undefined) return
  store.setDraft(toKey, value)
  store.clearDraft(fromKey)
}

export function useDraft(workspaceId: string, sessionId: string | undefined) {
  const key = draftKey(workspaceId, sessionId)
  const draft = useDraftStore((s) => s.drafts[key] ?? '')
  const setDraft = useDraftStore((s) => s.setDraft)
  const clearDraft = useDraftStore((s) => s.clearDraft)
  return {
    draft,
    setDraft: (value: string) => setDraft(key, value),
    clearDraft: () => clearDraft(key),
  }
}
