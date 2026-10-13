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
 *
 * Cost is linear in the bytes received, whatever the chunking: each chunk is
 * scanned once for line terminators, and a line that spans chunks is kept as
 * a list of fragments that is joined once, when its terminator arrives.
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

const LF = 10
const BOM = 0xfeff

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
  // The one leading BOM the spec allows is stripped by hand below: left to the
  // decoder, a BOM split across chunks is not handled consistently by runtimes.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  let atStreamStart = true

  let onAbort: (() => void) | null = null
  if (signal) {
    onAbort = () => {
      reader.cancel(signal.reason).catch(() => {})
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  // Fragments of the line whose terminator has not arrived yet. Never holds
  // an empty string, so a non-empty list means a non-empty line.
  let partial: string[] = []

  // The previous chunk ended on a CR. If the next character is LF it belongs
  // to that same CRLF terminator and must not start a new (blank) line.
  let pendingCR = false

  // Current event being accumulated. Fields reset on blank-line boundary.
  let currentEvent = 'message'
  let currentData: string[] = []

  function flush(): SSEEvent | null {
    if (currentData.length === 0 && currentEvent === 'message') return null
    const evt: SSEEvent = {
      event: currentEvent,
      data: currentData.length === 1 ? currentData[0] : currentData.join('\n'),
    }
    currentEvent = 'message'
    currentData = []
    return evt
  }

  function handleField(line: string): void {
    // Per spec: field ends at first ':'. Leading space after ':' is stripped.
    // Lines without ':' are field names with empty values (ignored here), and
    // a line starting with ':' is a comment.
    const colon = line.indexOf(':')
    if (colon <= 0) return
    const valueStart = line.charCodeAt(colon + 1) === 32 ? colon + 2 : colon + 1

    if (colon === 4 && line.startsWith('data')) {
      currentData.push(line.slice(valueStart))
    } else if (colon === 5 && line.startsWith('event')) {
      currentEvent = line.slice(valueStart) || 'message'
    }
    // Other fields (id, retry, unknown) are ignored by design.
  }

  try {
    let ended = false
    while (!ended) {
      const { done, value } = await reader.read()
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
      }

      // At end of stream, drain whatever the decoder still holds (an
      // incomplete multi-byte sequence becomes U+FFFD) through the same scan.
      ended = done
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
      const len = text.length

      let pos = 0
      if (len > 0) {
        if (atStreamStart) {
          atStreamStart = false
          if (text.charCodeAt(0) === BOM) pos = 1
        } else if (pendingCR) {
          pendingCR = false
          if (text.charCodeAt(0) === LF) pos = 1
        }
      }

      // Next LF / CR at or after `pos`. -2: not searched yet, -1: none left.
      // Each is searched forward only, so a chunk is scanned at most twice.
      let nl = -2
      let cr = -2
      while (pos < len) {
        if (nl !== -1 && nl < pos) nl = text.indexOf('\n', pos)
        if (cr !== -1 && cr < pos) cr = text.indexOf('\r', pos)

        let end: number
        if (nl === -1) {
          if (cr === -1) break
          end = cr
        } else {
          end = cr !== -1 && cr < nl ? cr : nl
        }

        let line = end === pos ? '' : text.slice(pos, end)
        if (partial.length > 0) {
          if (line !== '') partial.push(line)
          line = partial.length === 1 ? partial[0] : partial.join('')
          partial = []
        }

        pos = end + 1
        if (end === cr) {
          if (pos === len) pendingCR = true
          else if (text.charCodeAt(pos) === LF) pos++
        }

        if (line === '') {
          const evt = flush()
          if (evt) yield evt
        } else {
          handleField(line)
        }
      }

      if (pos < len) partial.push(pos === 0 ? text : text.slice(pos))
    }

    // Stream ended. A well-formed SSE stream ends with a blank line, but some
    // producers omit it; handle an unterminated last line and flush pending
    // field state just in case.
    if (partial.length > 0) {
      handleField(partial.length === 1 ? partial[0] : partial.join(''))
      partial = []
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
