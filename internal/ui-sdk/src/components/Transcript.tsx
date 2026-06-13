// Drop-in transcript: render a list of ChatMessage and wire up the providers
// (i18n locale, agent type, optional host markdown) in one component. This is
// the high-level entry most hosts want — e.g. Mission Control renders
// <Transcript messages={...} locale="zh-CN" />. Hosts that need finer control
// can compose MessageBubble + the providers themselves.
import { TranscriptI18nProvider } from '../i18n'
import { type MarkdownComponent, MarkdownProvider } from '../markdown'
import type { ChatMessage } from '../types'
import { TooltipProvider } from '../ui/tooltip'
import { AgentTypeProvider } from './AgentTypeContext'
import { MessageBubble } from './MessageBubble'

export interface TranscriptProps {
  messages: ChatMessage[]
  /** Agent runtime — selects the tool-renderer fallback set (default claude-code). */
  agentType?: string
  /** Host locale; anything zh-* maps to the bundled zh-CN strings. */
  locale?: string
  /** Inject a richer markdown renderer; omit to use the lean default. */
  markdown?: MarkdownComponent
  className?: string
}

export function Transcript({
  messages,
  agentType = 'claude-code',
  locale,
  markdown,
  className,
}: TranscriptProps) {
  const body = (
    <div className={className}>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  )
  return (
    <TranscriptI18nProvider locale={locale}>
      {/* Self-provide the tooltip context so the SDK works in hosts that don't
          set up a global TooltipProvider. */}
      <TooltipProvider>
        <AgentTypeProvider value={agentType}>
          {markdown ? <MarkdownProvider value={markdown}>{body}</MarkdownProvider> : body}
        </AgentTypeProvider>
      </TooltipProvider>
    </TranscriptI18nProvider>
  )
}
