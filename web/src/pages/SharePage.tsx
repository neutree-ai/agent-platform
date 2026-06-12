import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Markdown } from '@/components/ui/markdown'
import { Spinner } from '@/components/ui/spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { api } from '@/lib/api/client'
import type { ApiShareConfig, ApiShareData, ApiShareTrigger } from '@/lib/api/types'
import type { ChatMessage } from '@/stores/agent-session-store'
import {
  AgentTypeProvider,
  MarkdownProvider,
  MessageBubble,
  TurnStatsBar,
  toChatMessage,
} from '@neutree-ai/ui-sdk'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

function TriggerInfo({ trigger }: { trigger: ApiShareTrigger }) {
  const { t } = useTranslation()
  const label = t(`pages.share.triggers.${trigger.type}`, { defaultValue: trigger.type })
  return (
    <div className="flex items-center gap-1.5 text-mini text-muted-foreground">
      <Badge variant="outline" className="text-micro px-1.5 py-0">
        {label}
      </Badge>
      {trigger.schedule_name && <span className="font-mono">{trigger.schedule_name}</span>}
    </div>
  )
}

function ConfigSummary({ config }: { config: ApiShareConfig }) {
  const { t } = useTranslation()
  const [promptOpen, setPromptOpen] = useState(false)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-micro px-1.5 py-0">
          {config.agent_type}
        </Badge>
        <Badge variant="outline" className="text-micro px-1.5 py-0 font-mono">
          {config.model}
        </Badge>
        {config.template_name && (
          <Badge variant="outline" className="text-micro px-1.5 py-0">
            {config.template_name} v{config.template_version}
          </Badge>
        )}
        {config.skills.map((s) => (
          <Badge key={s} variant="outline" className="text-micro px-1.5 py-0">
            {s}
          </Badge>
        ))}
      </div>
      {config.system_prompt && (
        <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-mini text-muted-foreground hover:text-foreground">
            {promptOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {t('pages.share.config.systemPrompt')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-muted/50 p-2 text-tiny whitespace-pre-wrap break-words text-muted-foreground">
              {config.system_prompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function SharePage() {
  const { t } = useTranslation()
  const { shareId } = useParams<{ shareId: string }>()
  const [data, setData] = useState<ApiShareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!shareId) return
    api
      .getPublicShare(shareId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [shareId])

  // Backend stores 'Shared session' when no title was given; derive a better
  // display title from the first user message when available.
  const displayTitle = (() => {
    if (!data) return ''
    const firstUser =
      data.messages
        .find((m) => m.role === 'user')
        ?.content.trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80) ?? ''
    const isGeneric = !data.title || data.title === 'Shared session'
    return isGeneric ? firstUser || data.title || t('components.shareSession.untitled') : data.title
  })()

  useDocumentTitle(data ? displayTitle : null)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <div className="text-lg font-medium">{t('pages.share.notFound.title')}</div>
          <div className="text-sm text-muted-foreground">
            {t('pages.share.notFound.description')}
          </div>
        </div>
      </div>
    )
  }

  const chatMessages: ChatMessage[] = data.messages.map((msg) => toChatMessage(msg))
  const agentType = data.workspaceConfig?.agent_type ?? 'claude-code'

  const turnCount = chatMessages.reduce((n, m) => {
    if (m.role === 'user') return n + 1
    return n + m.blocks.filter((b) => b.type === 'tool').length
  }, 0)

  return (
    <AgentTypeProvider value={agentType}>
      <MarkdownProvider value={Markdown}>
        <div className="flex h-screen flex-col bg-background">
          <div className="flex min-h-0 flex-1">
            <div className="flex w-full flex-col">
              <div className="shrink-0 border-b border-border px-4 py-2">
                <div className="space-y-1.5 mx-auto w-full max-w-3xl">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <h1 className="min-w-0 truncate text-xs font-semibold">{displayTitle}</h1>
                      {data.owner_name && (
                        <span className="shrink-0 text-mini text-muted-foreground">
                          {t('pages.share.sharedBy', {
                            name: data.owner_name,
                            defaultValue: 'Shared by {{name}}',
                          })}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-mini text-muted-foreground">
                      {new Date(data.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {data.trigger && data.trigger.type !== 'manual' && (
                    <TriggerInfo trigger={data.trigger} />
                  )}
                  {data.workspaceConfig && <ConfigSummary config={data.workspaceConfig} />}
                </div>
              </div>
              {/* Messages scroll area — full column width */}
              <div className="min-h-0 flex-1 overflow-y-auto text-xs">
                <div className="p-3 space-y-3 mx-auto w-full max-w-3xl">
                  {chatMessages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                </div>
              </div>

              {/* Turn stats footer */}
              {(turnCount > 0 || data.turnStats) && (
                <TurnStatsBar
                  turns={turnCount}
                  contextTokens={data.turnStats?.contextTokens}
                  contextWindow={data.turnStats?.contextWindow}
                />
              )}
            </div>
          </div>
        </div>
      </MarkdownProvider>
    </AgentTypeProvider>
  )
}
