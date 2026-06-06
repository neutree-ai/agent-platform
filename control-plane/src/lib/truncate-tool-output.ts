const MAX_TOOL_OUTPUT_BYTES = 32 * 1024

// jsonb forbids U+0000; replace at the write boundary so payloads round-trip.
function stripNul(s: string): string {
  return s.replaceAll('\0', '\uFFFD')
}

export function truncateToolOutput(output: string): string {
  if (!output) return output
  const buf = Buffer.from(output, 'utf8')
  if (buf.length <= MAX_TOOL_OUTPUT_BYTES) return stripNul(output)
  const head = buf.subarray(0, MAX_TOOL_OUTPUT_BYTES).toString('utf8')
  const omitted = buf.length - MAX_TOOL_OUTPUT_BYTES
  console.warn(
    `[truncate-tool-output] capped tool_result original=${buf.length} kept=${MAX_TOOL_OUTPUT_BYTES} omitted=${omitted}`,
  )
  return stripNul(
    `${head}\n...[truncated by cp: ${omitted} bytes omitted, original ${buf.length} bytes]`,
  )
}
