import { useEffect, useRef } from 'react'
import { create } from 'zustand'

/**
 * Cross-panel channel for asking the chat composer to insert text.
 *
 * Panels outside the chat (e.g. the file browser's "Add to chat" action) can't
 * reach the composer's `<textarea>` directly — they may even live in the same
 * slot, where only the active app is mounted (see `SlotContainer`). So they
 * leave a request here; the composer consumes it via
 * {@link useComposerInsertRequests} once it is (or becomes) mounted.
 */
interface ComposerInsertRequest {
  /** Workspace the request targets — only that workspace's composer reacts. */
  workspaceId: string
  /** Text to splice in, e.g. `@file/src/main.tsx`. */
  text: string
}

interface ComposerState {
  request: ComposerInsertRequest | null
  /** Ask the chat composer for `workspaceId` to splice `text` in at its caret. */
  requestInsert: (workspaceId: string, text: string) => void
}

export const useComposerStore = create<ComposerState>((set) => ({
  request: null,
  requestInsert: (workspaceId, text) => set({ request: { workspaceId, text } }),
}))

/**
 * Wire a chat composer to {@link useComposerStore}: when another panel calls
 * `requestInsert` for this workspace, hand the text to `insert` (the
 * composer's caret-aware insert, which also restores focus and selection).
 *
 * The request is *consumed* (cleared) on handling. That way a composer mounting
 * late — e.g. after a slot switch unmounted it — still picks up a request made
 * while it was gone, and a later remount doesn't replay a stale one.
 */
export function useComposerInsertRequests({
  workspaceId,
  enabled,
  insert,
}: {
  workspaceId: string
  enabled: boolean
  insert: (text: string) => void
}) {
  const request = useComposerStore((s) => s.request)
  // Keep the latest callback reachable without widening deps.
  const insertRef = useRef(insert)
  insertRef.current = insert

  useEffect(() => {
    if (!enabled || !request) return
    if (request.workspaceId !== workspaceId) return
    // Compare-and-consume: bail if it was already taken (another composer, or
    // StrictMode's second effect pass). Clearing it here is also what stops a
    // later remount of this composer from replaying the same insert.
    if (useComposerStore.getState().request !== request) return
    useComposerStore.setState({ request: null })
    insertRef.current(request.text)
  }, [request, workspaceId, enabled])
}
