import crypto from 'crypto'
import WebSocket from 'ws'
import type { Connector, Route } from '../services/db'
import { getSocket } from './wecom'

export async function wecomSend(
  connector: Connector,
  route: Route,
  text: string,
  replyTo?: Record<string, unknown>,
) {
  const ws = getSocket(connector.id)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Connector ${connector.name}: WebSocket not connected`)
  }

  const reqId = replyTo?.req_id as string | undefined
  const chatId = (replyTo?.chat_id as string) || route.external_id

  if (reqId) {
    // Passive reply using the original req_id (1-hour window, single use)
    ws.send(JSON.stringify({
      cmd: 'aibot_respond_msg',
      headers: { req_id: reqId },
      body: {
        msgtype: 'markdown',
        markdown: { content: text },
      },
    }))
  } else {
    // No req_id available — this would need aibot_subscribe proactive push
    // For now, log a warning
    console.warn(`[WeCom] ${connector.name}: no req_id for reply to chat=${chatId}, cannot send`)
    throw new Error('No req_id available for WeCom reply. Passive reply window may have expired.')
  }
}

// --- Streaming ---

// Per-session quota is 30/min·1000/hour, shared between stream frames and
// non-stream replies (doc 101463). Over-quota frames are silently dropped, so
// we throttle to ≤24/min (2500ms interval) — leaves headroom for the placeholder,
// the final finish frame, and any other route activity in the same chat.
// WeCom's client also coalesces refreshes, so finer cadence wouldn't render
// as "true typewriter" anyway.
const STREAM_FLUSH_INTERVAL_MS = 2500

interface StreamState {
  connectorId: string
  connectorName: string
  reqId: string
  streamId: string
  content: string
  lastFlushAt: number
  timer: NodeJS.Timeout | null
}

const streams = new Map<string, StreamState>()

// Mirrors @wecom/aibot-node-sdk's generateReqId('stream'): `stream_<ts>_<rand>`.
// stream.id MUST be a freshly minted id with the `stream_` prefix; reusing the
// inbound headers.req_id makes WeCom drop subsequent frames after the first.
function newStreamId(): string {
  return `stream_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function flushFrame(state: StreamState, finish: boolean) {
  const ws = getSocket(state.connectorId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Connector ${state.connectorName}: WebSocket not connected`)
  }
  ws.send(JSON.stringify({
    cmd: 'aibot_respond_msg',
    headers: { req_id: state.reqId },
    body: {
      msgtype: 'stream',
      stream: {
        id: state.streamId,
        content: state.content,
        finish,
      },
    },
  }))
  state.lastFlushAt = Date.now()
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
}

export async function wecomSendStream(
  connector: Connector,
  route: Route,
  replyTo: Record<string, unknown> | undefined,
  chunk: { content: string; finish: boolean },
) {
  const reqId = replyTo?.req_id as string | undefined
  const chatId = (replyTo?.chat_id as string) || route.external_id
  if (!reqId) {
    console.warn(`[WeCom] ${connector.name}: no req_id for stream reply to chat=${chatId}`)
    throw new Error('No req_id available for WeCom stream reply.')
  }

  let state = streams.get(reqId)
  if (!state) {
    state = {
      connectorId: connector.id,
      connectorName: connector.name,
      reqId,
      streamId: newStreamId(),
      content: '',
      lastFlushAt: 0,
      timer: null,
    }
    streams.set(reqId, state)
  }

  // Scheduler sends cumulative snapshots; replace, never append.
  state.content = chunk.content

  if (chunk.finish) {
    // Final frame must always be sent, regardless of throttle.
    try {
      flushFrame(state, true)
    } finally {
      streams.delete(reqId)
    }
    return
  }

  // Non-final: throttle. If we haven't flushed in INTERVAL, flush now;
  // otherwise schedule a trailing flush so the latest content lands.
  const elapsed = Date.now() - state.lastFlushAt
  if (elapsed >= STREAM_FLUSH_INTERVAL_MS) {
    flushFrame(state, false)
    return
  }
  if (state.timer) return // already scheduled
  const wait = STREAM_FLUSH_INTERVAL_MS - elapsed
  state.timer = setTimeout(() => {
    state!.timer = null
    // State may have been cleared by a finish frame in the meantime.
    if (!streams.has(reqId)) return
    try {
      flushFrame(state!, false)
    } catch (e) {
      console.warn(`[WeCom] ${connector.name}: throttled stream flush failed:`, e)
    }
  }, wait)
}
