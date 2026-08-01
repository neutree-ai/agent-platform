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

/**
 * Poll `fn` until it returns a truthy value or the timeout expires.
 * Returns the first truthy result, or `null` on timeout.
 */
export async function waitUntil<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 30_000, intervalMs = 2_000 } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) return result
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}
