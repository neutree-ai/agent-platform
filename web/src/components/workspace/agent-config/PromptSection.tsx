import { useTranslation } from 'react-i18next'
import { PromptField } from '../PromptField'

interface PromptSectionProps {
  promptId: string | null
  systemPrompt: string
  promptName: string | null
  promptContent: string | null
  onChange: (patch: { promptId?: string | null; systemPrompt?: string }) => void
  onRevert?: () => void
  templateConfig?: {
    prompt_id: string | null
    system_prompt: string
    prompt_name: string | null
    prompt_content: string | null
  } | null
}

export function PromptSection({
  promptId,
  systemPrompt,
  promptName: _promptName,
  promptContent: _promptContent,
  onChange,
  onRevert,
  templateConfig,
}: PromptSectionProps) {
  const { t } = useTranslation()
  return (
    <PromptField
      label={t('components.promptSection.labels.source')}
      promptId={promptId}
      content={systemPrompt}
      onChange={(patch) =>
        onChange({
          promptId: patch.promptId,
          systemPrompt: patch.content,
        })
      }
      placeholder={t('components.promptEditor.placeholders.content')}
      showLibraryActions
      previewMaxHeight="300px"
      textareaRows={12}
      templatePromptId={templateConfig?.prompt_id}
      onRevert={onRevert}
    />
  )
}
