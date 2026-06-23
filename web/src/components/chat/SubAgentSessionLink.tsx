import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

/**
 * The session id shown in a call_agent tool result, as a link when the
 * sub-agent's session is reachable.
 *
 * Injected into the SDK's call_agent renderer (see `setSubAgentSessionLink`), so
 * it only mounts when a call_agent card is expanded — the callable-agents query
 * fires lazily then and is cached/shared (same key as the @mention menu).
 *
 * Only the user's OWN agents are linked: their session lives in a workspace the
 * user owns and can open. Another user's public agent runs in a workspace the
 * user can't view, so it stays plain text.
 */
export function SubAgentSessionLink({ slug, sessionId }: { slug: string; sessionId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: agents } = useQuery({
    queryKey: ['callable-agents'],
    queryFn: () => api.getCallableAgents(),
  })

  // Mirror call_agent's addressing: "owner/slug" cross-user, bare slug for own.
  const list = agents ?? []
  const agent = slug.includes('/')
    ? (() => {
        const [owner, bare] = slug.split('/')
        return list.find((a) => a.owner === owner && a.slug === bare)
      })()
    : list.find((a) => a.is_own && a.slug === slug)

  const label = shortId(sessionId)
  if (!agent?.is_own) {
    return (
      <span className="font-mono text-mini text-muted-foreground" title={sessionId}>
        {label}
      </span>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate(`/w/${agent.id}?session=${encodeURIComponent(sessionId)}`)}
      // Neutralize the default button height/padding/icon size down to this
      // tool card's dense chip scale, matching the sibling status chips.
      className="h-auto gap-1 rounded bg-info/15 px-1.5 py-0.5 font-mono text-mini font-normal text-info hover:bg-info/25 hover:text-info [&_svg]:size-3"
      title={t('components.subAgentSessionLink.viewSession')}
    >
      <ArrowUpRight />
      {label}
    </Button>
  )
}
