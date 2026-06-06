/**
 * Neutral SSE line reader.
 *
 * Reads an SSE `Response` body and yields parsed events according to the
 * WHATWG EventSource spec subset that NAP actually uses: `event:` and `data:`
 * fields, blank-line event boundaries, CR/LF/CRLF line endings, and
 * multi-line `data:` concatenation with `\n`.
 *
 * Intentionally excluded (add only when needed):
 *   - `id:` last-event-id bookkeeping
 *   - `retry:` reconnection hints
 *   - Comment lines (starting with `:`)
 *
 * This layer is domain-neutral. It does not parse JSON, does not care about
 * any NAP event shape, and does not reconnect on errors. Upper layers add
 * JSON parsing, UniversalEvent typing, reconnect, and persistence.
 */

export interface SSEEvent {
  event: string
  data: string
}

export interface ReadSSEOptions {
  signal?: AbortSignal
}

export async function* readSSE(
  response: Response,
  options?: ReadSSEOptions,
): AsyncGenerator<SSEEvent, void, void> {
  if (!response.body) {
    throw new Error('readSSE: response has no body')
  }

  const signal = options?.signal
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')

  let onAbort: (() => void) | null = null
  if (signal) {
    onAbort = () => {
      reader.cancel(signal.reason).catch(() => {})
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  // Line-buffering across chunks. SSE lines are delimited by \n, \r, or \r\n;
  // we normalize by treating \r\n and \r as \n before splitting.
  let lineBuffer = ''

  // Current event being accumulated. Fields reset on blank-line boundary.
  let currentEvent = 'message'
  let currentData: string[] = []

  function flush(): SSEEvent | null {
    if (currentData.length === 0 && currentEvent === 'message') return null
    const evt: SSEEvent = {
      event: currentEvent,
      data: currentData.join('\n'),
    }
    currentEvent = 'message'
    currentData = []
    return evt
  }

  function handleField(line: string): void {
    // Per spec: field ends at first ':'. Leading space after ':' is stripped.
    // Lines without ':' are field names with empty values (ignored here).
    const colon = line.indexOf(':')
    if (colon === -1) return
    const field = line.slice(0, colon)
    let value = line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'data') {
      currentData.push(value)
    } else if (field === 'event') {
      currentEvent = value || 'message'
    }
    // Other fields (id, retry, unknown) are ignored by design.
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
      }
      if (done) break

      lineBuffer += decoder.decode(value, { stream: true })

      // Normalize line endings, then split. We keep the last (possibly
      // partial) fragment in lineBuffer until the next chunk.
      const normalized = lineBuffer.replace(/\r\n?/g, '\n')
      const lines = normalized.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line === '') {
          const evt = flush()
          if (evt) yield evt
        } else {
          handleField(line)
        }
      }
    }

    // Stream ended. Flush any remaining decoder state and handle trailing
    // content. A well-formed SSE stream ends with a blank line, but some
    // producers omit it; we flush pending field state just in case.
    lineBuffer += decoder.decode()
    if (lineBuffer.length > 0) {
      const normalized = lineBuffer.replace(/\r\n?/g, '\n')
      const lines = normalized.split('\n')
      for (const line of lines) {
        if (line === '') {
          const evt = flush()
          if (evt) yield evt
        } else {
          handleField(line)
        }
      }
    }
    const trailing = flush()
    if (trailing) yield trailing
  } finally {
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
    try {
      reader.releaseLock()
    } catch {
      // Reader already released (e.g. after cancel).
    }
  }
}
