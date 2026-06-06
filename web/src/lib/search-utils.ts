import type { ChatMessage } from '@/stores/agent-session-store'

interface SearchMatch {
  messageId: string
  /** Index within the flattened list of all matches (used for "3/12" counter) */
  globalIndex: number
}

/**
 * Pure function: find all search matches across chat messages.
 * Searches user `content` and assistant text blocks.
 * Returns one SearchMatch per occurrence.
 */
export function searchMessages(messages: ChatMessage[], query: string): SearchMatch[] {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  const matches: SearchMatch[] = []
  let globalIndex = 0

  for (const msg of messages) {
    const texts =
      msg.role === 'user'
        ? [msg.content]
        : msg.blocks
            .filter((b) => b.type === 'text')
            .map((b) => (b as { type: 'text'; text: string }).text)

    for (const text of texts) {
      const lower = text.toLowerCase()
      let idx = lower.indexOf(q)
      while (idx !== -1) {
        matches.push({ messageId: msg.id, globalIndex })
        globalIndex++
        idx = lower.indexOf(q, idx + q.length)
      }
    }
  }

  return matches
}
