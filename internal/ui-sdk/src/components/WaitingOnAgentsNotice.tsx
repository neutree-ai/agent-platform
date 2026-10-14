import { useSdkLocale, useSdkTranslation } from '../i18n'

interface WaitingOnAgentsNoticeProps {
  /** Agent calls still running: the session's `pending_agent_calls`. */
  count: number
  /** Host locale (e.g. "zh-CN", "en"). Anything zh-* maps to zh-CN. */
  locale?: string
}

/**
 * Shown above the composer while the agent waits on agents it called. No turn
 * is running, so the composer is open, yet the conversation is not over: the
 * results start the agent's next turn on their own. Renders nothing at 0.
 */
export function WaitingOnAgentsNotice({ count, locale }: WaitingOnAgentsNoticeProps) {
  useSdkLocale(locale)
  const { t } = useSdkTranslation()
  if (count <= 0) return null
  return (
    <div className="flex items-center justify-center gap-1.5 px-3 pb-1 text-tiny text-muted-foreground">
      <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-info" />
      <span>{t('components.chat.waitingOnAgents', { count })}</span>
    </div>
  )
}
