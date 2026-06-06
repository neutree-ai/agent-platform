import { CommandFields } from '@/components/workspace/CommandFields'
import type { WorkspaceCommand } from '@/lib/api/types'
import { useState } from 'react'

export function CommandForm({
  formId,
  initial,
  onSubmit,
}: {
  formId: string
  initial?: WorkspaceCommand
  onSubmit: (data: {
    name: string
    type: 'plain' | 'struct'
    prompt_id?: string | null
    content?: string
  }) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'plain' | 'struct'>(initial?.type ?? 'plain')
  const [promptId, setPromptId] = useState<string | null>(initial?.prompt_id ?? null)
  const [content, setContent] = useState(initial?.content ?? '')

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          name,
          type,
          prompt_id: promptId,
          content: promptId ? '' : content,
        })
      }}
    >
      <CommandFields
        value={{ name, type, prompt_id: promptId, content }}
        onChange={(patch) => {
          if (patch.name !== undefined) setName(patch.name)
          if (patch.type !== undefined) setType(patch.type)
          if (patch.prompt_id !== undefined) setPromptId(patch.prompt_id)
          if (patch.content !== undefined) setContent(patch.content)
        }}
      />
    </form>
  )
}
