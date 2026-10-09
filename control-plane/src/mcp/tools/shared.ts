export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * Failure result. Sets `isError` so the caller can tell a failure from a
 * successful call that merely returned text starting with "Error" — without it
 * the model has to string-match to know whether the tool worked.
 */
export function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

/** Success result carrying a JSON payload. */
export function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value))
}
