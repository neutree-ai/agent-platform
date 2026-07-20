import type { ApiMessage, ApiSession } from '../../types/api'
import type { ChatImageAttachment, UniversalEvent } from '../../types/events'
import type { HttpClient } from './http'
import { type AgentActions, parseSSEStream } from './sse'

export class SessionsApi {
  constructor(private http: HttpClient) {}

  // The endpoint answers a paginated envelope; callers want the rows.
  async list(workspaceId: string): Promise<ApiSession[]> {
    const res = await this.http.fetchJson<{ items: ApiSession[] }>(
      `/api/workspaces/${workspaceId}/sessions`,
    )
    return res.items
  }

  async create(workspaceId: string, params?: { name?: string }): Promise<ApiSession> {
    return this.http.fetchJson(`/api/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    })
  }

  async delete(workspaceId: string, sessionId: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${workspaceId}/sessions/${sessionId}`, {
      method: 'DELETE',
    })
  }

  async interrupt(workspaceId: string, sessionId: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${workspaceId}/sessions/${sessionId}/interrupt`, {
      method: 'POST',
    })
  }

  async chat(
    workspaceId: string,
    message: string,
    options?: {
      sessionId?: string
      timeout?: number
      onEvent?: (event: UniversalEvent) => void
      images?: ChatImageAttachment[]
    },
  ): Promise<AgentActions> {
    const controller = new AbortController()
    const timeout = options?.timeout ?? 120_000
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      // The documented entry point. The older `/_proxy/agent/:id/chat` is a raw
      // passthrough to the agent pod: same UniversalEvent frames, but the turn
      // never reaches the control plane's persistence, so the session and its
      // messages are invisible to /sessions and /messages afterwards.
      const res = await this.http.fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          mode: 'stream',
          session_id: options?.sessionId ?? null,
          ...(options?.images?.length ? { images: options.images } : {}),
        }),
        signal: controller.signal,
      })

      if (!res.body) {
        throw new Error('No response body (expected SSE stream)')
      }

      return await parseSSEStream(res.body, {
        onEvent: options?.onEvent,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async reconnect(
    workspaceId: string,
    sessionId: string,
    options?: {
      timeout?: number
      onEvent?: (event: UniversalEvent) => void
    },
  ): Promise<AgentActions> {
    const controller = new AbortController()
    const timeout = options?.timeout ?? 120_000
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const res = await this.http.fetch(
        `/_proxy/agent/${workspaceId}/sessions/${sessionId}/reconnect`,
        {
          signal: controller.signal,
        },
      )

      if (!res.body) {
        throw new Error('No response body (expected SSE stream)')
      }

      return await parseSSEStream(res.body, {
        onEvent: options?.onEvent,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async respond(workspaceId: string, sessionId: string, body: unknown): Promise<void> {
    await this.http.fetch(`/_proxy/agent/${workspaceId}/sessions/${sessionId}/respond`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async pendingQuestion(workspaceId: string, sessionId: string): Promise<unknown> {
    return this.http.fetchJson(
      `/_proxy/agent/${workspaceId}/sessions/${sessionId}/pending-question`,
    )
  }

  // session_id is required by the server — messages are always read per session.
  async getMessages(workspaceId: string, sessionId: string): Promise<ApiMessage[]> {
    return this.http.fetchJson(
      `/api/workspaces/${workspaceId}/messages?session_id=${encodeURIComponent(sessionId)}`,
    )
  }
}
