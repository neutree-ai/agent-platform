// Static normalizer: wire `ApiMessage` → render-ready `ChatMessage`. Pairs
// tool_call/tool_result by call_id and parses tool arguments. This is the
// polling path (Mission Control); the main app's streaming store builds the
// same ChatMessage shape incrementally.
import { transcriptI18n } from './i18n'
import type { ApiContentPart, ApiMessage, ChatMessage, ContentBlock } from './types'

export function toChatMessage(message: ApiMessage): ChatMessage {
  const blocks: ContentBlock[] = []
  const parts = (Array.isArray(message.blocks) ? message.blocks : []) as ApiContentPart[]
  const resultMap = new Map<string, { output: string; is_error?: boolean; timestamp?: number }>()
  for (const p of parts) {
    if (p.type === 'tool_result') {
      resultMap.set(p.call_id, {
        output: p.output,
        is_error: p.is_error,
        timestamp: (p as any).timestamp,
      })
    }
  }
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image') {
      blocks.push({ type: 'image', data: (part as any).data, media_type: (part as any).media_type })
    } else if (part.type === 'tool_call') {
      const result = resultMap.get(part.call_id)
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(part.arguments)
      } catch {}
      blocks.push({
        type: 'tool',
        tool: {
          id: part.call_id,
          name: part.name ?? transcriptI18n.t('components.chat.toolRenderers.labels.unknown'),
          input,
          result: result?.output,
          isError: result?.is_error,
          startedAt: (part as any).started_at,
          completedAt: (part as any).completed_at,
          resultAt: result?.timestamp,
          parentToolUseId: (part as any).parent_tool_use_id ?? null,
        },
      })
    }
  }
  return {
    id: String(message.id),
    role: message.role,
    content: message.content,
    blocks,
    created_at: message.created_at,
  }
}
