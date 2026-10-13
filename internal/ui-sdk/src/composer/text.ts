// Pure text helpers for the composer: command templates, trigger detection at
// the caret, and caret-aware insertion.

const TEMPLATE_VAR = /\{\{(\w+)\}\}/g

/** Unique `{{var}}` names in a command template, in first-appearance order. */
export function parseTemplateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(TEMPLATE_VAR)].map((m) => m[1]))]
}

/** Substitute `{{var}}` placeholders; unknown variables resolve to an empty string. */
export function resolveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR, (_, key: string) => values[key] ?? '')
}

/** The slash-command query when the whole input is a single `/…` line, else null. */
export function getSlashQuery(value: string): string | null {
  if (!value.startsWith('/') || value.includes('\n')) return null
  return value.slice(1).toLowerCase()
}

export interface TriggerMatch {
  /** Index where the matched fragment starts. */
  start: number
  /** Index where it ends (the caret). */
  end: number
  /** Capture group 1 of the pattern, or '' if it has none. */
  query: string
}

/**
 * Match `pattern` against the text up to the caret. The pattern should be
 * anchored with `$` so it only matches a fragment that ends at the caret.
 */
export function matchTrigger(pattern: RegExp, value: string, caret: number): TriggerMatch | null {
  const before = value.slice(0, caret)
  const re = pattern.global ? new RegExp(pattern.source, pattern.flags.replace('g', '')) : pattern
  const m = before.match(re)
  if (!m) return null
  return { start: before.length - m[0].length, end: caret, query: m[1] ?? '' }
}

/** Replace `[start, end)` with `text`; the caret lands right after the insert. */
export function replaceRange(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}

/**
 * Splice `text` in over the selection, padding with spaces so it never fuses
 * with an adjacent word. A space also lands before the final caret: triggers
 * key off the text up to the caret, so that space keeps a just-inserted
 * mention (e.g. `@file/…`) from reopening its picker. When the text after the
 * selection already starts with whitespace it is reused instead of adding a
 * second space, and the caret lands just past it.
 */
export function insertWithPadding(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  text: string,
): { value: string; caret: number } {
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const afterStartsBlank = /^\s/.test(after)
  const trail = afterStartsBlank ? '' : ' '
  const piece = `${lead}${text}${trail}`
  return {
    value: before + piece + after,
    caret: before.length + piece.length + (afterStartsBlank ? 1 : 0),
  }
}
