import type { ComponentType, ReactNode } from 'react'
import type { ComposerSendKey } from './keys'

/** An image attached to the next message, in the platform's wire shape. */
export interface ComposerImageAttachment {
  /** Base64-encoded bytes (no `data:` prefix). */
  data: string
  /** MIME type, e.g. `image/png`. */
  media_type: string
}

/** A slash command offered by the `/` menu. Expanded client-side into plain text. */
export interface ComposerCommand {
  /** Name typed after `/`. Also the key within the menu. */
  name: string
  /**
   * `plain` sends `content` as-is. `struct` opens a form for each `{{var}}` in
   * `content` and sends the resolved text.
   */
  type: 'plain' | 'struct'
  /** Message text, or the `{{var}}` template for `struct` commands. */
  content: string
  /** Secondary line in the menu. Defaults to `content`. */
  description?: string
  /** Optional marker shown before the name (e.g. for library-backed commands). */
  icon?: ComponentType<{ className?: string }>
}

/** One row of a trigger menu. */
export interface ComposerTriggerItem {
  /** Stable key, unique within one result set. */
  key: string
  label: ReactNode
  description?: ReactNode
  /** Right-aligned secondary text. */
  meta?: ReactNode
  icon?: ReactNode
  /** Text that replaces the matched fragment (from the trigger start to the caret). */
  insertText: string
  /**
   * Keep the menu open after inserting, so the trigger re-evaluates against
   * the new text (e.g. drilling into a folder, or handing off to another
   * trigger). Otherwise the menu stays closed until the text changes again.
   */
  keepOpen?: boolean
}

/** A caret-anchored suggestion source, e.g. `@file/…` or `@agent/…`. */
export interface ComposerTrigger {
  /** Stable id; also scopes result caching and element ids. */
  id: string
  /**
   * Matched against the text before the caret; anchor it with `$`. Capture
   * group 1 becomes the query. When several triggers match, the one whose
   * fragment starts closest to the caret wins.
   */
  pattern: RegExp
  /** Items for a query. Stale async results (superseded query) are dropped. */
  getItems: (
    query: string,
    signal: AbortSignal,
  ) => ComposerTriggerItem[] | Promise<ComposerTriggerItem[]>
  /** Delay before `getItems` for a non-empty query. An empty query loads immediately. */
  debounceMs?: number
  /**
   * While a newer query is loading, the previous results stay on screen,
   * passed through this filter so typing narrows them without waiting.
   */
  narrow?: (items: ComposerTriggerItem[], query: string) => ComposerTriggerItem[]
  /** Optional line above the items. */
  header?: (query: string) => ReactNode
}

/** Speech-to-text wiring. */
export interface ComposerVoice {
  /** Turn recorded audio into text. Reject with an Error whose message is user-facing. */
  transcribe: (audio: Blob) => Promise<string>
  /**
   * Toggle recording with ⌘/Ctrl+Shift+M from anywhere on the page. Opt-in so
   * several composers on one page don't fight over the shortcut.
   */
  shortcut?: boolean
  /** Called with a user-facing message on failure. Defaults to `window.alert`. */
  onError?: (message: string) => void
}

/** Host-owned attachment state. The attach button and image paste appear only when set. */
export interface ComposerAttachments {
  items: ComposerImageAttachment[]
  /** Receives newly picked or pasted images, already base64-encoded. */
  onAdd: (items: ComposerImageAttachment[]) => void
  onRemove: (index: number) => void
  /** `accept` for the file picker. Defaults to `image/*`. */
  accept?: string
}

/** Queued follow-up state, driven by the host while `running`. */
export interface ComposerPending {
  /** True when the composer text differs from what is queued. */
  dirty: boolean
  /** Drop the queued message. Shows a discard button when set. */
  onDiscard?: () => void
}

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  /**
   * Submit the current text (possibly empty when only images are attached).
   * While `running`, a submit means "queue this"; the host decides what that
   * does. The composer never clears `value` or attachments itself.
   */
  onSubmit: (text: string, attachments: ComposerImageAttachment[]) => void
  /**
   * Run an expanded slash command. The composer has already cleared the input.
   * Defaults to `onSubmit(text, [])`.
   */
  onRunCommand?: (text: string, command: ComposerCommand) => void
  /** Shows a stop button while `running`. */
  onStop?: () => void
  /** The agent is working: the toolbar collapses and submits become queue requests. */
  running?: boolean
  /** Blocks submitting and the toolbar (e.g. while the session is being reset). */
  disabled?: boolean
  /** Read-only view: text is not editable and no actions render. */
  readOnly?: boolean
  /**
   * Allow submitting while `running` (queueing a follow-up). Default true.
   * When false, submits are ignored while running.
   */
  allowQueue?: boolean
  pending?: ComposerPending | null
  sendKey?: ComposerSendKey
  /** Overrides the send-key-aware default placeholder. */
  placeholder?: string
  attachments?: ComposerAttachments
  voice?: ComposerVoice
  /** Commands shown immediately in the `/` menu, in order. */
  commands?: ComposerCommand[]
  /** Loaded each time the `/` menu opens; appended after `commands`. */
  loadCommands?: () => Promise<ComposerCommand[]>
  triggers?: ComposerTrigger[]
  /** Extra controls in the bottom-left toolbar (between attach and voice). Hidden while running. */
  toolbar?: ReactNode
  /** Content above the input box, inside the composer. */
  header?: ReactNode
  /** Locale for the composer's own strings (e.g. `zh-CN`); anything zh-* maps to zh-CN. */
  locale?: string
  className?: string
  /** Classes for the textarea (e.g. font size). */
  textareaClassName?: string
}

export interface ComposerHandle {
  /** Focus the textarea; `caret: 'end'` also moves the caret to the end. */
  focus: (options?: { caret?: 'end' }) => void
  /**
   * Splice text in at the caret (or over the selection) with word padding,
   * then focus and place the caret after it. The textarea keeps its selection
   * while blurred, so this targets where the user last left the caret.
   */
  insertAtCaret: (text: string) => void
  /** The underlying textarea, for measurement or advanced integrations. */
  readonly textarea: HTMLTextAreaElement | null
}
