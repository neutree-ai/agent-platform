import { Button } from '@/components/ui/button'
import type { AskUserRequest } from '@/lib/api/types'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// The agent looks each answer up by the question's full text, and reads a
// multi-select answer as its option labels joined by ", ". Keeping selections
// as a list per question covers both cases without widening the wire shape.
const ANSWER_SEPARATOR = ', '

export function AskUserQuestionPanel({
  request,
  onRespond,
}: {
  request: AskUserRequest
  onRespond: (answers: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})

  const selected = (question: string) => selections[question] ?? []

  const toggle = (question: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[question] ?? []
      if (!multiSelect) return { ...prev, [question]: [label] }
      return {
        ...prev,
        [question]: current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label],
      }
    })
    setCustomInputs((prev) => ({ ...prev, [question]: '' }))
  }

  const allAnswered = request.questions.every(
    (q) => selected(q.question).length > 0 || customInputs[q.question]?.trim(),
  )

  const buildAnswers = () => {
    const answers: Record<string, string> = {}
    for (const q of request.questions) {
      answers[q.question] =
        customInputs[q.question]?.trim() || selected(q.question).join(ANSWER_SEPARATOR)
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
          {q.multiSelect && (
            <div className="text-mini text-muted-foreground">
              {t('components.askUserQuestion.hints.selectAllThatApply')}
            </div>
          )}
          <div className="space-y-1">
            {q.options.map((opt) => {
              const isSelected =
                selected(q.question).includes(opt.label) && !customInputs[q.question]?.trim()
              return (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggle(q.question, opt.label, q.multiSelect)}
                  className={`w-full rounded border p-2 text-left text-xs transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    {q.multiSelect && (
                      <Check
                        className={`mt-0.5 size-3 shrink-0 ${
                          isSelected ? 'text-primary' : 'text-transparent'
                        }`}
                      />
                    )}
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      {opt.description && (
                        <div className="mt-0.5 text-muted-foreground">{opt.description}</div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
            <input
              type="text"
              placeholder={t('components.askUserQuestion.actions.customReplyPlaceholder')}
              value={customInputs[q.question] || ''}
              onChange={(e) => {
                setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))
                if (e.target.value.trim()) {
                  setSelections((prev) => ({ ...prev, [q.question]: [] }))
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
