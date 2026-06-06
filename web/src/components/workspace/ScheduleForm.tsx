import { getBrowserTimezone } from '@/components/ui/timezone-select'
import {
  ScheduleFields,
  type ScheduleMode,
  defaultRunAt,
  detectScheduleMode,
  toDatetimeLocal,
} from '@/components/workspace/ScheduleFields'
import type { Schedule } from '@/lib/api/types'
import { useState } from 'react'

// Re-exported so existing importers (ScheduleDialog) keep their import path.
export { detectScheduleMode }
export type { ScheduleMode }

export function ScheduleForm({
  formId,
  initial,
  mode,
  onModeChange,
  onSubmit,
}: {
  formId: string
  initial?: Schedule
  /** Controlled by the dialog so it can drive a mode-specific docs panel. */
  mode: ScheduleMode
  onModeChange: (m: ScheduleMode) => void
  onSubmit: (data: {
    name: string
    cron?: string | null
    run_at?: string | null
    timezone: string
    prompt: string
    prompt_id?: string | null
  }) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [cron, setCron] = useState(initial?.cron ?? '0 9 * * *')
  const [runAt, setRunAt] = useState<string>(
    initial?.run_at ? toDatetimeLocal(new Date(initial.run_at)) : defaultRunAt(),
  )
  const [timezone, setTimezone] = useState(initial?.timezone ?? getBrowserTimezone())
  const [promptId, setPromptId] = useState<string | null>(initial?.prompt_id ?? null)
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')

  // Editing a completed one-time schedule is disabled at the API layer; the
  // dialog gates this by not offering the edit button, but be defensive.
  const isCompleted = !!initial?.completed_at

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        if (mode === 'recurring') {
          onSubmit({
            name,
            cron,
            run_at: null,
            timezone,
            prompt: promptId ? '' : prompt,
            prompt_id: promptId,
          })
        } else {
          // datetime-local has no tz suffix; interpret as local wall-clock and
          // send an ISO instant. The `timezone` field is display metadata.
          const runAtIso = new Date(runAt).toISOString()
          onSubmit({
            name,
            cron: null,
            run_at: runAtIso,
            timezone,
            prompt: promptId ? '' : prompt,
            prompt_id: promptId,
          })
        }
      }}
      className="space-y-4"
    >
      <ScheduleFields
        value={{ name, cron, run_at: runAt, timezone, prompt, prompt_id: promptId }}
        onChange={(patch) => {
          if (patch.name !== undefined) setName(patch.name)
          if (patch.cron !== undefined) setCron(patch.cron)
          if (patch.run_at !== undefined) setRunAt(patch.run_at)
          if (patch.timezone !== undefined) setTimezone(patch.timezone)
          if (patch.prompt !== undefined) setPrompt(patch.prompt)
          if (patch.prompt_id !== undefined) setPromptId(patch.prompt_id)
        }}
        mode={mode}
        onModeChange={onModeChange}
        modeDisabled={isCompleted}
      />
    </form>
  )
}
