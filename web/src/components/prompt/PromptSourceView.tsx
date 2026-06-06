import { PromptViewer } from '@/components/prompt/PromptViewer'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { usePrompts } from '@/hooks/usePrompts'
import { api } from '@/lib/api/client'
import type { ApiPrompt, PromptVisibility } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Globe, Lock, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Readonly twin of `<PromptField>`. Resolves a `promptId` against the
 * current user's prompt library, falling back to a single `GET /prompts/:id`
 * when the prompt isn't in the cached list (cross-team / stale). When only
 * `content` is provided, renders the raw text without any header.
 *
 * Visibility icon mapping is duplicated from `PromptField.tsx` on purpose
 * (see task brief: keep visually in sync, refactor later).
 */
const VISIBILITY_ICON: Record<PromptVisibility, typeof Lock> = {
  private: Lock,
  team: Users,
  public: Globe,
}

interface PromptSourceViewProps {
  /** Library reference. Takes precedence over `content` when set. */
  promptId?: string | null
  /** Raw prompt text fallback. */
  content?: string
  /** Forwarded to PromptViewer. Default "200px". */
  maxHeight?: string
  /** Shown when neither promptId nor content is provided. */
  emptyText?: string
  /** Show name + visibility chip when in promptId mode. Default true. */
  showHeader?: boolean
  className?: string
}

export function PromptSourceView({
  promptId,
  content,
  maxHeight = '200px',
  emptyText,
  showHeader = true,
  className,
}: PromptSourceViewProps) {
  const { t } = useTranslation()
  const { prompts, isLoading: listLoading } = usePrompts()
  const cached = promptId ? prompts.find((p) => p.id === promptId) : undefined

  // Fall back to per-id fetch only when we have an id but the cached list
  // doesn't contain it (cross-team prompt, or list still loading and id is
  // not visible there).
  const shouldFetch = !!promptId && !cached && !listLoading
  const {
    data: fetched,
    isLoading: fetchLoading,
    isError,
  } = useQuery<ApiPrompt>({
    queryKey: ['prompts', 'detail', promptId],
    queryFn: () => api.getPrompt(promptId as string),
    enabled: shouldFetch,
    retry: false,
  })

  const prompt = cached ?? fetched

  if (promptId) {
    if (listLoading || fetchLoading) {
      return (
        <div className={cn('flex items-center gap-2 py-2', className)}>
          <Spinner size="sm" />
        </div>
      )
    }
    if (!prompt) {
      // Not accessible (404 / no permission) — show id + muted hint.
      return (
        <div className={cn('space-y-1', className)}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono text-tiny">
            {promptId}
          </code>
          {isError && (
            <div className="text-tiny text-muted-foreground">
              {t('components.promptSourceView.notAccessible')}
            </div>
          )}
        </div>
      )
    }
    const VisIcon = VISIBILITY_ICON[prompt.visibility]
    const teamLabel = prompt.shared_via_teams.map((tm) => tm.name).join(', ')
    return (
      <div className={cn('space-y-2', className)}>
        {showHeader && (
          <div className="flex flex-wrap items-center gap-1.5">
            <VisIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="text-xs font-medium text-foreground truncate">{prompt.name}</span>
            {!prompt.is_own && prompt.owner_name && (
              <span className="text-mini text-muted-foreground/60 truncate">
                @{prompt.owner_name}
              </span>
            )}
            {!prompt.is_own && (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-1.5 text-mini border-info/30 bg-info/10 text-info"
              >
                {prompt.visibility === 'team' && teamLabel
                  ? teamLabel
                  : t(`components.promptEditor.visibility.${prompt.visibility}`)}
              </Badge>
            )}
          </div>
        )}
        <PromptViewer
          content={prompt.content}
          variant="inline"
          maxHeight={maxHeight}
          emptyText={t('components.promptSourceView.empty')}
        />
      </div>
    )
  }

  if (content && content.trim().length > 0) {
    return (
      <PromptViewer
        content={content}
        variant="inline"
        maxHeight={maxHeight}
        emptyText={t('components.promptSourceView.empty')}
        className={className}
      />
    )
  }

  return (
    <div className={cn('text-tiny text-muted-foreground', className)}>
      {emptyText ?? t('components.promptSourceView.empty')}
    </div>
  )
}
