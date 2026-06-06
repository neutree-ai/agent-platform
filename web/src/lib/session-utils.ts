/**
 * Clean session preview text by stripping XML tags, Slack user mentions,
 * and other noise from automated integrations.
 */
export function cleanSessionPreview(text: string): string {
  const cleaned = text
    .replace(/<\/?[a-z_]+>/gi, '') // strip XML-like tags: <thread_context>, </thread_context>, etc.
    .replace(/\[user:<@[A-Z0-9]+>\]/g, '') // strip [user:<@U05D9P1ULCW>]
    .replace(/<@[A-Z0-9]+>/g, '') // strip bare <@U05D9P1ULCW> mentions

  // Take the first non-empty line — multi-line first messages (pasted logs,
  // structured prompts) shouldn't bleed into the title.
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.replace(/[\t ]+/g, ' ').trim()
    if (trimmed) return trimmed
  }
  return ''
}
