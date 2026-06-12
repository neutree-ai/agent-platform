import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api/client'
import type { ApiAgentRequest } from '@/lib/api/types'
import {
  useAgentSessionActions,
  useAgentSessionStore,
  useHasAgentSessionProvider,
} from '@/stores/AgentSessionContext'
import {
  type ToolCall,
  getMcpText,
  jsonPreview,
  safeParseResult,
  unwrapMcpInput,
} from '@neutree-ai/ui-sdk'
import { Check, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderAgentRequestBody } from './agent-request-bodies'

/**
 * Renderer for any `*_propose` MCP tool that returns a structured
 * `{ request_id, kind, label }` envelope. The tool result is treated as a
 * pointer to a real `agent_requests` row; this renderer fetches it, renders
 * a pending Approve/Reject card with a per-kind body, and on resolve posts a
 * plain text user message back into the session so the agent loop runs the
 * matching `*_apply` tool.
 */
interface ProposeEnvelope {
  request_id: string
  kind: string
  label: string
  payload?: unknown
  status?: 'pending' | 'approved' | 'rejected' | 'applied'
}

function parseEnvelope(tool: ToolCall): ProposeEnvelope | null {
  const text = getMcpText(tool.result)
  if (!text) return null
  const parsed = safeParseResult<ProposeEnvelope>(text)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as ProposeEnvelope).request_id !== 'string'
  ) {
    return null
  }
  return parsed as ProposeEnvelope
}

export const agentRequestProposeRenderer = {
  defaultExpanded: true,
  getPreview(tool: ToolCall): string {
    const env = parseEnvelope(tool)
    if (env) return env.label
    return jsonPreview(unwrapMcpInput(tool.input))
  },
  renderInput() {
    // Hide the raw propose args — the structured card below carries the same info.
    return <div />
  },
  renderResult(tool: ToolCall) {
    const env = parseEnvelope(tool)
    if (!env) {
      // Tool errored before producing an envelope (e.g. "Error: workspace not found").
      const text = getMcpText(tool.result)
      return text ? <div className="text-tiny text-destructive">{text}</div> : null
    }
    return <AgentRequestCard envelope={env} />
  },
}

/**
 * Picks the interactive or static card depending on whether an
 * `AgentSessionProvider` is in scope. The public `SharePage` renders chat
 * messages without one — there the card must not call session hooks (they
 * throw) and has no actor to approve/reject on behalf of.
 */
function AgentRequestCard({ envelope }: { envelope: ProposeEnvelope }) {
  const hasSessionProvider = useHasAgentSessionProvider()
  return hasSessionProvider ? (
    <AgentRequestCardInteractive envelope={envelope} />
  ) : (
    <AgentRequestCardStatic envelope={envelope} />
  )
}

/** Read-only card: renders the envelope's body + status, no fetch, no actions. */
function AgentRequestCardStatic({ envelope }: { envelope: ProposeEnvelope }) {
  const req: ApiAgentRequest | null =
    envelope.payload !== undefined && envelope.status !== undefined
      ? {
          id: envelope.request_id,
          workspace_id: '',
          user_id: '',
          kind: envelope.kind,
          payload: envelope.payload as Record<string, unknown>,
          status: envelope.status,
          reject_reason: null,
          applied_at: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        }
      : null
  const body = req ? renderAgentRequestBody(req) : null

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/[0.06] bg-muted/30">
        <Sparkles className="h-3.5 w-3.5 text-accent-foreground shrink-0" />
        <span className="text-tiny font-medium text-foreground truncate">{envelope.label}</span>
        {envelope.status && <StatusBadge status={envelope.status} />}
      </div>
      {body && <div className="px-3 py-2.5">{body}</div>}
    </div>
  )
}

function AgentRequestCardInteractive({ envelope }: { envelope: ProposeEnvelope }) {
  const { t } = useTranslation()
  const workspaceId = useAgentSessionStore((s) => s.workspaceId)
  const isBusy = useAgentSessionStore((s) => s.isBusy)
  const actions = useAgentSessionActions()
  const seeded: ApiAgentRequest | null =
    envelope.payload !== undefined && envelope.status !== undefined
      ? {
          id: envelope.request_id,
          workspace_id: workspaceId,
          user_id: '',
          kind: envelope.kind,
          payload: envelope.payload as Record<string, unknown>,
          status: envelope.status,
          reject_reason: null,
          applied_at: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        }
      : null
  const [req, setReq] = useState<ApiAgentRequest | null>(seeded)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .getAgentRequest(workspaceId, envelope.request_id)
      .then((r) => {
        if (!cancelled) setReq(r)
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, envelope.request_id])

  async function resolve(decision: 'approved' | 'rejected', rejectReason?: string) {
    setPending(true)
    try {
      const updated = await api.resolveAgentRequest(
        workspaceId,
        envelope.request_id,
        decision,
        rejectReason,
      )
      setReq(updated)
      const reasonSuffix = decision === 'rejected' && rejectReason ? ` Reason: ${rejectReason}` : ''
      const body =
        decision === 'approved'
          ? `Request ${envelope.request_id} has been approved. Please call the matching apply tool with request_id="${envelope.request_id}" to finalize.`
          : `Request ${envelope.request_id} has been rejected.${reasonSuffix} Do not call the apply tool.`
      actions.sendMessage(`<agent-sys>${body}</agent-sys>`)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-tiny text-destructive">
        {t('components.chat.toolRenderers.agentRequest.loadFailed')}: {loadError}
      </div>
    )
  }

  if (!req) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-tiny text-muted-foreground">
        {t('components.chat.toolRenderers.agentRequest.loading')}
      </div>
    )
  }

  const isPending = req.status === 'pending'
  const body = renderAgentRequestBody(req)

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/[0.06] bg-muted/30">
        <Sparkles className="h-3.5 w-3.5 text-accent-foreground shrink-0" />
        <span className="text-tiny font-medium text-foreground truncate">{envelope.label}</span>
        <StatusBadge status={req.status} />
      </div>

      {body && <div className="px-3 py-2.5">{body}</div>}

      {isPending && (
        <div className="px-3 py-2 border-t border-foreground/[0.06] bg-muted/20">
          {!showRejectForm ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="default"
                onClick={() => resolve('approved')}
                disabled={pending || isBusy}
                className="h-6 gap-1 px-2.5 text-mini font-medium"
              >
                <Check className="h-3 w-3" />
                {t('components.chat.toolRenderers.agentRequest.approve')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRejectForm(true)}
                disabled={pending || isBusy}
                className="h-6 gap-1 px-2 text-mini text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                {t('components.chat.toolRenderers.agentRequest.reject')}
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('components.chat.toolRenderers.agentRequest.reasonPlaceholder')}
                className="h-6 text-mini"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolve('rejected', reason.trim() || undefined)}
                  disabled={pending || isBusy}
                  className="h-6 px-2.5 text-mini font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {t('components.chat.toolRenderers.agentRequest.confirmReject')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowRejectForm(false)
                    setReason('')
                  }}
                  disabled={pending || isBusy}
                  className="h-6 px-2 text-mini text-muted-foreground"
                >
                  {t('components.chat.toolRenderers.agentRequest.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {req.status === 'rejected' && req.reject_reason && (
        <div className="px-3 py-2 border-t border-foreground/[0.06] bg-muted/20 text-tiny text-muted-foreground">
          <span className="font-medium text-foreground">
            {t('components.chat.toolRenderers.agentRequest.reason')}:
          </span>{' '}
          {req.reject_reason}
        </div>
      )}

      {req.status === 'applied' && (
        <div className="px-3 py-2 border-t border-foreground/[0.06] bg-muted/20 text-tiny text-muted-foreground">
          <span className="font-medium text-foreground">
            {t('components.chat.toolRenderers.agentRequest.appliedAt')}:
          </span>{' '}
          {req.applied_at ? new Date(req.applied_at).toLocaleString() : ''}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ApiAgentRequest['status'] }) {
  const { t } = useTranslation()
  let variant: 'secondary' | 'success-soft' | 'destructive-soft' | 'accent-soft'
  switch (status) {
    case 'approved':
      variant = 'success-soft'
      break
    case 'rejected':
      variant = 'destructive-soft'
      break
    case 'applied':
      variant = 'accent-soft'
      break
    default:
      variant = 'secondary'
      break
  }
  return (
    <Badge
      variant={variant}
      className="ml-auto h-5 px-2 text-mini font-medium rounded-full shrink-0"
    >
      {t(`components.chat.toolRenderers.agentRequest.status.${status}`)}
    </Badge>
  )
}
