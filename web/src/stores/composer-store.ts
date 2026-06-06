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
 * `requestInsert` for this workspace, splice the text in at the textarea's
 * caret, then return focus and selection there.
 *
 * The request is *consumed* (cleared) on handling. That way a composer mounting
 * late — e.g. after a slot switch unmounted it — still picks up a request made
 * while it was gone, and a later remount doesn't replay a stale one.
 *
 * A `<textarea>` keeps `selectionStart` while blurred, so the caret the user
 * last left in the composer is still the right insertion point even though
 * focus has moved away to the file browser.
 */
export function useComposerInsertRequests({
  workspaceId,
  enabled,
  inputRef,
  setInput,
  onInserted,
}: {
  workspaceId: string
  enabled: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  setInput: (value: string) => void
  onInserted?: () => void
}) {
  const request = useComposerStore((s) => s.request)
  // Keep the latest non-stable callbacks reachable without widening deps.
  const latestRef = useRef({ setInput, onInserted })
  latestRef.current = { setInput, onInserted }

  useEffect(() => {
    if (!enabled || !request) return
    if (request.workspaceId !== workspaceId) return
    // Compare-and-consume: bail if it was already taken (another composer, or
    // StrictMode's second effect pass). Clearing it here is also what stops a
    // later remount of this composer from replaying the same insert.
    if (useComposerStore.getState().request !== request) return
    useComposerStore.setState({ request: null })

    const el = inputRef.current
    const current = el?.value ?? ''
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? start
    const before = current.slice(0, start)
    const after = current.slice(end)
    // Pad so the mention never fuses with an adjacent word. A space must also
    // sit *before* the final caret: the `@file/` picker keys off the text up to
    // the caret, and that space is what keeps it dismissed after the insert.
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const afterStartsBlank = /^\s/.test(after)
    const trail = afterStartsBlank ? '' : ' '
    const piece = `${lead}${request.text}${trail}`
    // When `after` already opens with whitespace, reuse it instead of adding a
    // second space — land the caret just past it.
    const caret = before.length + piece.length + (afterStartsBlank ? 1 : 0)

    latestRef.current.setInput(before + piece + after)
    // Defer focus to a macrotask so it runs after the file browser's Radix
    // dropdown finishes its own close-time focus restoration (which would
    // otherwise pull focus back to the menu trigger).
    setTimeout(() => {
      if (el) {
        el.focus()
        el.setSelectionRange(caret, caret)
      }
      latestRef.current.onInserted?.()
    }, 0)
  }, [request, workspaceId, enabled, inputRef])
}
