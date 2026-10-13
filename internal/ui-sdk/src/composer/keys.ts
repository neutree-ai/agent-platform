// Keyboard helpers for the composer: IME-safe Enter detection, the send-key
// decision, and platform-aware modifier labels.

/**
 * Which key combination sends the message.
 * - `mod-enter`: Cmd/Ctrl+Enter sends, Enter inserts a newline.
 * - `enter`: Enter sends, Shift+Enter or Cmd/Ctrl+Enter inserts a newline.
 */
export type ComposerSendKey = 'mod-enter' | 'enter'

/** Structural subset of React's synthetic and the DOM's native keyboard events. */
interface KeyEventLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

/**
 * True while an IME composition is in progress. During composition Enter
 * confirms a candidate (e.g. pinyin) and must never submit or pick a menu
 * item. Covers `isComposing` on synthetic and native events plus the legacy
 * 229 keyCode older Safari emits for the confirming keydown.
 */
export function isComposingKey(e: KeyEventLike): boolean {
  const native = e.nativeEvent ?? e
  return !!native.isComposing || native.keyCode === 229
}

/**
 * Whether a keydown should submit under `mode`. Never true during IME
 * composition.
 *
 * `touch` marks a touch-first device (no hover, coarse pointer): soft
 * keyboards have no modifier keys and their Enter is the only way to type a
 * newline, so Enter always inserts a newline there and sending goes through
 * the send button (a hardware Cmd/Ctrl+Enter still sends).
 */
export function shouldSubmitOnKey(
  e: KeyEventLike,
  mode: ComposerSendKey,
  opts: { touch?: boolean } = {},
): boolean {
  if (e.key !== 'Enter' || isComposingKey(e)) return false
  const withMod = e.metaKey || e.ctrlKey
  const effective: ComposerSendKey = opts.touch ? 'mod-enter' : mode
  if (effective === 'mod-enter') return withMod && !e.shiftKey
  return !withMod && !e.shiftKey
}

/** True on macOS / iOS, where the primary modifier is ⌘ rather than Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Label for the primary modifier key: `⌘` on Apple platforms, `Ctrl` elsewhere. */
export function modifierLabel(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl'
}

/** True on touch-first devices (no hover, coarse pointer). */
export function isTouchFirst(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}
