import { Markdown } from '@/components/ui/markdown'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChatMessage } from '@/stores/agent-session-store'
import { ClipboardCheck, Copy } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolCallBlock } from './ToolCallBlock'

function formatTimestamp(iso: string, locale: string): { short: string; full: string } {
  const date = new Date(iso)
  const now = new Date()
  const full = date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const time = date.toLocaleString(locale, { hour: '2-digit', minute: '2-digit' })
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const short = sameDay
    ? time
    : date.toLocaleString(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
  return { short, full }
}

function MessageBubbleImpl({ message }: { message: ChatMessage }) {
  const { t, i18n } = useTranslation()
  const isUser = message.role === 'user'
  // Auto-emitted system messages (see `<agent-sys>` convention in
  // components/ui/markdown.tsx) are posted via sendMessage so the agent
  // sees them as user turns, but visually they shouldn't look like the
  // human typed a blue bubble. Detect the whole-message wrapper and route
  // them through Markdown on the assistant-side layout — AgentSysBlock
  // then folds them into a neutral disclosure.
  const isAgentSysAuto =
    isUser &&
    typeof message.content === 'string' &&
    /^\s*<agent-sys>[\s\S]*<\/agent-sys>\s*$/.test(message.content)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const textContent = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
    const content = textContent || (isUser ? String(message.content ?? '') : '')
    if (!content) return
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [message.blocks, message.content, isUser])

  return (
    <div
      className={`group/msg flex flex-col ${isUser && !isAgentSysAuto ? 'items-end' : 'items-start'}`}
    >
      {isAgentSysAuto ? (
        <div className="w-full min-w-0 break-words">
          <Markdown>{message.content as string}</Markdown>
        </div>
      ) : isUser ? (
        <div className="max-w-[70%] overflow-hidden break-words rounded-2xl rounded-tr-md bg-primary/90 px-3.5 py-2 text-primary-foreground shadow-sm">
          <div className="whitespace-pre-wrap break-words text-[1em]">{message.content}</div>
          {message.blocks
            .filter((b) => b.type === 'image')
            .map((block, idx) =>
              block.type === 'image' ? (
                <img
                  key={idx}
                  src={`data:${block.media_type};base64,${block.data}`}
                  alt={t('components.chat.messageBubble.alts.attachment')}
                  className="mt-2 max-w-full max-h-48 rounded-md border border-primary-foreground/20"
                />
              ) : null,
            )}
        </div>
      ) : (
        <div className="w-full min-w-0 break-words">
          {message.blocks.map((block, idx) =>
            block.type === 'text' ? (
              /^(API\s+)?Error[\s:]/i.test(block.text.trim()) ? (
                <div
                  key={idx}
                  className="my-1.5 rounded-md border border-destructive/20 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"
                >
                  {block.text}
                </div>
              ) : (
                <Markdown
                  key={idx}
                  mode={
                    message.isStreaming && idx === message.blocks.length - 1
                      ? 'streaming'
                      : 'static'
                  }
                  linkifyWorkspaceFiles
                >
                  {block.text}
                </Markdown>
              )
            ) : block.type === 'tool' ? (
              <ToolCallBlock key={block.tool.id} tool={block.tool} />
            ) : block.type === 'status' ? (
              <div
                key={idx}
                className={`my-1.5 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-mini ${
                  block.isError
                    ? 'bg-destructive/[0.08] text-destructive'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${block.isError ? 'bg-destructive' : 'bg-muted-foreground/60'}`}
                />
                <span className="font-medium">{block.label}</span>
                {block.detail && <span className="opacity-70">{block.detail}</span>}
              </div>
            ) : block.type === 'image' ? (
              <img
                key={idx}
                src={`data:${block.media_type};base64,${block.data}`}
                alt={t('components.chat.messageBubble.alts.content')}
                className="my-2 max-w-full max-h-96 rounded-md border border-foreground/[0.08]"
              />
            ) : null,
          )}
          {message.isStreaming && message.blocks.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t('components.chat.messageBubble.states.thinking')}
            </div>
          )}
          {/* Fallback for legacy/error messages that wrote raw text into
              `content` without populating `blocks` (e.g. pre-agent auth
              failures). Without this, the bubble renders empty and the user
              cannot tell anything happened. Skip while streaming so the
              spinner above stays visible. */}
          {!message.isStreaming && message.blocks.length === 0 && message.content && (
            <div className="whitespace-pre-wrap break-words text-[1em]">{message.content}</div>
          )}
        </div>
      )}
      {/* Copy button + timestamp — visible on hover, hidden while streaming */}
      {!message.isStreaming && (
        <div className="mt-0.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          {message.created_at &&
            (() => {
              const ts = formatTimestamp(
                message.created_at,
                i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US',
              )
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-xs text-muted-foreground/60">
                      {ts.short}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {ts.full}
                  </TooltipContent>
                </Tooltip>
              )
            })()}
          <button
            type="button"
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
              copied ? 'text-success' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={handleCopy}
            title={
              copied
                ? t('components.chat.messageBubble.actions.copied')
                : t('components.chat.messageBubble.actions.copy')
            }
          >
            {copied ? <ClipboardCheck className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
