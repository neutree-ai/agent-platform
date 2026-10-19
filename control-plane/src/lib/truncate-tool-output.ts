import type { UniversalEvent } from '../../../internal/types/events'

export const MAX_TOOL_OUTPUT_BYTES = 32 * 1024

// jsonb forbids U+0000; replace at the write boundary so payloads round-trip.
function stripNul(s: string): string {
  return s.replaceAll('\0', '\uFFFD')
}

export function truncateToolOutput(output: string, options?: { log?: boolean }): string {
  if (!output) return output
  const buf = Buffer.from(output, 'utf8')
  if (buf.length <= MAX_TOOL_OUTPUT_BYTES) return stripNul(output)
  const head = buf.subarray(0, MAX_TOOL_OUTPUT_BYTES).toString('utf8')
  const omitted = buf.length - MAX_TOOL_OUTPUT_BYTES
  if (options?.log !== false) {
    console.warn(
      `[truncate-tool-output] capped tool_result original=${buf.length} kept=${MAX_TOOL_OUTPUT_BYTES} omitted=${omitted}`,
    )
  }
  return stripNul(
    `${head}\n...[truncated by cp: ${omitted} bytes omitted, original ${buf.length} bytes]`,
  )
}

/**
 * Cap the tool_result outputs of a raw agent event before it is relayed to SSE
 * clients, so they receive the same output that is persisted. A single tool
 * call can return tens of MB (e.g. a grep over raw logs); relayed verbatim,
 * every client has to buffer, decode and parse the whole event at once.
 *
 * Returns `rawData` itself unless the event is a completed tool_result with an
 * output over MAX_TOOL_OUTPUT_BYTES.
 */
export function capToolResultEvent(evt: UniversalEvent, rawData: string): string {
  if (evt.type !== 'item.completed' || evt.item?.kind !== 'tool_result') return rawData
  const content = evt.item.content ?? []
  const oversized = content.some(
    (part) =>
      part.type === 'tool_result' &&
      !!part.output &&
      Buffer.byteLength(part.output, 'utf8') > MAX_TOOL_OUTPUT_BYTES,
  )
  if (!oversized) return rawData
  return JSON.stringify({
    ...evt,
    item: {
      ...evt.item,
      content: content.map((part) =>
        part.type === 'tool_result' && part.output
          ? // The persist path already logged this cap.
            { ...part, output: truncateToolOutput(part.output, { log: false }) }
          : part,
      ),
    },
  })
}
