import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

type AnyKeyboardEvent = ReactKeyboardEvent | KeyboardEvent

/**
 * True while an IME composition is in progress. During composition the Enter
 * key selects a candidate (e.g. confirming pinyin) and must NOT trigger
 * submit/confirm actions. Covers `isComposing` on both React synthetic and raw
 * events, plus the legacy 229 keyCode emitted by older Safari.
 */
export function isComposing(e: AnyKeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e
  return native.isComposing || native.keyCode === 229
}

/**
 * True when the event is an Enter keypress that should commit/submit — i.e.
 * Enter pressed while NOT composing with an IME. Modifier keys are not
 * inspected; callers layer their own modifier logic on top as needed.
 */
export function isCommitEnter(e: AnyKeyboardEvent): boolean {
  return e.key === 'Enter' && !isComposing(e)
}
