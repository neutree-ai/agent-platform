import { Button } from '@/components/ui/button'
import type { AskUserRequest } from '@/lib/api/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AskUserQuestionPanel({
  request,
  onRespond,
}: {
  request: AskUserRequest
  onRespond: (answers: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})

  const allAnswered = request.questions.every(
    (q) => selections[q.question] || customInputs[q.question]?.trim(),
  )

  const buildAnswers = () => {
    const answers: Record<string, string> = {}
    for (const q of request.questions) {
      answers[q.question] = customInputs[q.question]?.trim() || selections[q.question] || ''
    }
    return answers
  }

  return (
    <div className="mx-3 mb-2 max-h-[60vh] overflow-y-auto rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      {request.questions.map((q) => (
        <div key={q.question} className="space-y-1.5">
          {q.header && (
            <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-mini font-medium text-primary">
              {q.header}
            </span>
          )}
          <div className="text-xs font-medium">{q.question}</div>
          <div className="space-y-1">
            {q.options.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => {
                  setSelections((prev) => ({ ...prev, [q.question]: opt.label }))
                  setCustomInputs((prev) => ({ ...prev, [q.question]: '' }))
                }}
                className={`w-full rounded border p-2 text-left text-xs transition-colors ${
                  selections[q.question] === opt.label && !customInputs[q.question]?.trim()
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                {opt.description && (
                  <div className="mt-0.5 text-muted-foreground">{opt.description}</div>
                )}
              </button>
            ))}
            <input
              type="text"
              placeholder={t('components.askUserQuestion.actions.customReplyPlaceholder')}
              value={customInputs[q.question] || ''}
              onChange={(e) => {
                setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))
                if (e.target.value.trim()) {
                  setSelections((prev) => ({ ...prev, [q.question]: '' }))
                }
              }}
              className="w-full rounded border border-border bg-transparent p-2 text-xs placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      ))}
      <Button
        size="sm"
        className="w-full"
        disabled={!allAnswered}
        onClick={() => onRespond(buildAnswers())}
      >
        {t('components.askUserQuestion.actions.confirm')}
      </Button>
    </div>
  )
}
