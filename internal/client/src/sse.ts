import type { ContentPart, UniversalEvent } from '../../types/events'

/** Parsed actions from a complete agent turn */
export interface AgentActions {
  sessionId: string | null
  toolCalls: ContentPart[]
  textContent: string
  events: UniversalEvent[]
  stats: UniversalEvent['stats'] | null
}

/** Parse an SSE stream into structured agent actions */
export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  options?: {
    onEvent?: (event: UniversalEvent) => void
    signal?: AbortSignal
  },
): Promise<AgentActions> {
  const result: AgentActions = {
    sessionId: null,
    toolCalls: [],
    textContent: '',
    events: [],
    stats: null,
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function processChunk(chunk: string) {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue

      let event: UniversalEvent
      try {
        event = JSON.parse(line.slice(6))
      } catch {
        continue
      }

      result.events.push(event)
      options?.onEvent?.(event)

      switch (event.type) {
        case 'session.started':
          result.sessionId = event.session_id ?? null
          break

        case 'item.completed':
          if (event.item) {
            for (const cp of event.item.content) {
              if (cp.type === 'tool_call') {
                result.toolCalls.push(cp)
              } else if (cp.type === 'text' && cp.text) {
                result.textContent += cp.text
              }
            }
          }
          break

        case 'session.ended':
          result.stats = event.stats ?? null
          break
      }
    }
  }

  try {
    while (true) {
      if (options?.signal?.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const parts = buffer.split('\n\n')
      buffer = parts.pop()!

      for (const part of parts) {
        processChunk(part)
      }
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      processChunk(buffer)
    }
  } finally {
    reader.releaseLock()
  }

  return result
}
