import { PopoutLayer } from '@/components/shell/PopoutLayer'
import { SlotContainer } from '@/components/shell/SlotContainer'
import { LAYOUTS } from '@/components/shell/layout/layouts'
import { BreathingHalo } from '@/components/ui/breathing-halo'
import { useSlotContext } from '@/contexts/SlotContext'
import { useActiveLayout } from '@/hooks/useActiveLayout'
import { useAgentInfo } from '@/hooks/useAgentInfo'
import { useAutoSelectSession } from '@/hooks/useAutoSelectSession'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSessions } from '@/hooks/useSessions'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { AgentSessionProvider } from '@/stores/AgentSessionContext'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

export function WorkspacePage() {
  const { t } = useTranslation()
  const { data: workspaces, isFetching: workspacesFetching } = useWorkspaces()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()
  const { layoutId } = useActiveLayout(workspaceId)
  const ActiveLayout = LAYOUTS[layoutId].Component
  const slotCtx = useSlotContext()
  const filledSlot = slotCtx?.filledSlot ?? null

  const { data: sessions = [], isFetching: sessionsFetching } = useSessions(workspaceId)
  const { initialSessionId, initialSession } = useAutoSelectSession(sessions, sessionsFetching)

  const syncSessionToUrl = useCallback(
    (sessionId: string | undefined) => {
      setSearchParams(
        (sp) => {
          if (sessionId) sp.set('session', sessionId)
          else sp.delete('session')
          return sp
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (
      workspaceId &&
      workspaces &&
      !workspacesFetching &&
      !workspaces.some((w) => w.id === workspaceId)
    ) {
      navigate('/')
    }
  }, [workspaceId, workspaces, workspacesFetching, navigate])

  const selectedWorkspace = useMemo(
    () => workspaces?.find((ws) => ws.id === workspaceId),
    [workspaces, workspaceId],
  )

  useAgentInfo(workspaceId)
  useDocumentTitle(selectedWorkspace?.name)

  if (!selectedWorkspace) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
        {t('pages.workspace.empty.selectWorkspace')}
      </div>
    )
  }

  return (
    <AgentSessionProvider
      key={selectedWorkspace.id}
      workspaceId={selectedWorkspace.id}
      workspaceName={selectedWorkspace.name}
      initialSessionId={initialSessionId}
      initialContext={{
        sessionChatStatus: initialSession?.chat_status,
        lastTurnStats: initialSession?.last_turn_stats,
      }}
      syncSessionToUrl={syncSessionToUrl}
    >
      {/* Desktop withholds SlotProvider until the workspace profile is
          fetched, so slotCtx==null here means we're in that pre-load
          window. Show a breathing halo so the surface feels alive without
          flashing default layout state. */}
      {!slotCtx ? (
        <BreathingHalo />
      ) : filledSlot ? (
        <div className="flex h-full min-h-0 p-3">
          <SlotContainer slotId={filledSlot} />
        </div>
      ) : (
        <ActiveLayout />
      )}
      {/* Mounted inside AgentSessionProvider so popped-out apps that read
          session state (chat, etc.) find their context. SlotProvider lives
          one level up in Desktop, so SlotContext is available too. */}
      {slotCtx && <PopoutLayer />}
    </AgentSessionProvider>
  )
}
