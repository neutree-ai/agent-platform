import crypto from 'node:crypto'
import WebSocket from 'ws'
import * as db from '../services/db'
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
    ws.send(
      JSON.stringify({
        cmd: 'aibot_respond_msg',
        headers: { req_id: reqId },
        body: {
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }),
    )
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

// WeCom expires a stream after a freshness window of minutes; frames sent
// after expiry are silently dropped. While a stream is open, re-flush the
// current snapshot on this cadence — independent of scheduler pushes — so a
// long-running job (tool-heavy turns with no visible text) keeps its stream
// alive until the finish frame. 2 frames/min is well inside the quota above.
const KEEPALIVE_INTERVAL_MS = 30_000

// The passive-reply req_id itself expires after 1 hour; past that neither
// stream frames nor markdown replies can be delivered. Stop keepalive and
// drop the stream state a bit before the hard deadline — a finish arriving
// later takes the no-state markdown fallback (a last-ditch attempt).
const STREAM_MAX_AGE_MS = 55 * 60_000

interface StreamState {
  connectorId: string
  connectorName: string
  routeId: string
  reqId: string
  streamId: string
  content: string
  openedAt: number
  lastFlushAt: number
  timer: NodeJS.Timeout | null
  keepalive: NodeJS.Timeout | null
  framesSent: number
  acksOk: number
  acksErr: number
  lastErr: { errcode: number; errmsg: string } | null
  /** Set when a flush failed at the transport level (WS down mid-job). */
  broken: boolean
}

const streams = new Map<string, StreamState>()

// Mirrors @wecom/aibot-node-sdk's generateReqId('stream'): `stream_<ts>_<rand>`.
// stream.id MUST be a freshly minted id with the `stream_` prefix; reusing the
// inbound headers.req_id makes WeCom drop subsequent frames after the first.
function newStreamId(): string {
  return `stream_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function clearStream(state: StreamState) {
  if (state.timer) clearTimeout(state.timer)
  if (state.keepalive) clearInterval(state.keepalive)
  state.timer = null
  state.keepalive = null
  streams.delete(state.reqId)
}

function flushFrame(state: StreamState, finish: boolean) {
  const ws = getSocket(state.connectorId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Connector ${state.connectorName}: WebSocket not connected`)
  }
  ws.send(
    JSON.stringify({
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
    }),
  )
  state.framesSent++
  state.lastFlushAt = Date.now()
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
}

function startKeepalive(state: StreamState) {
  state.keepalive = setInterval(() => {
    if (streams.get(state.reqId) !== state) {
      // Superseded or finished elsewhere — stop ticking.
      clearInterval(state.keepalive!)
      return
    }
    if (Date.now() - state.openedAt > STREAM_MAX_AGE_MS) {
      console.warn(
        `[WeCom] ${state.connectorName}: stream req=${state.reqId} exceeded max age, dropping state`,
      )
      clearStream(state)
      return
    }
    // Only fill silence: a recent scheduler-driven flush already refreshed it.
    if (Date.now() - state.lastFlushAt < KEEPALIVE_INTERVAL_MS - 1000) return
    try {
      flushFrame(state, false)
    } catch (e) {
      state.broken = true
      console.warn(
        `[WeCom] ${state.connectorName}: keepalive flush failed for req=${state.reqId}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }, KEEPALIVE_INTERVAL_MS)
  // Don't hold the process open for keepalives.
  state.keepalive.unref?.()
}

/**
 * Consume a WebSocket response frame for an `aibot_respond_msg` we sent.
 * WeCom acks every respond with `{headers:{req_id}, errcode, errmsg}`; before
 * this existed `ws.send` was treated as delivery, so expired-stream drops were
 * recorded as success. Returns true when the ack matched an open stream.
 */
export function handleRespondAck(frame: {
  headers?: { req_id?: string }
  errcode?: number
  errmsg?: string
}): boolean {
  const reqId = frame.headers?.req_id
  if (!reqId) return false
  const state = streams.get(reqId)
  if (!state) return false
  if (frame.errcode === 0) {
    state.acksOk++
    return true
  }
  state.acksErr++
  state.lastErr = { errcode: frame.errcode ?? -1, errmsg: frame.errmsg ?? '' }
  console.error(
    `[WeCom] ${state.connectorName}: stream frame rejected errcode=${frame.errcode} errmsg=${frame.errmsg} req=${reqId}`,
  )
  db.logEvent({
    route_id: state.routeId,
    connector_id: state.connectorId,
    event_type: 'send',
    payload: { stream: true, req_id: reqId, errcode: frame.errcode },
    status: 'error',
    error: frame.errmsg || `errcode=${frame.errcode}`,
  }).catch(() => {})
  return true
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

  if (chunk.finish) {
    // No open stream to finish — the gateway restarted mid-job or the stream
    // aged out. A finish-only frame on a fresh stream id may not render, and
    // if the old stream expired it would be silently dropped; deliver the
    // reply as a plain passive markdown message instead.
    if (!state) {
      console.warn(
        `[WeCom] ${connector.name}: finish with no open stream req=${reqId}, sending as markdown`,
      )
      await wecomSend(connector, route, chunk.content, replyTo)
      return
    }
    state.content = chunk.content
    // Frames were rejected or the transport dropped mid-job: assume the
    // stream is dead. Still fire the finish frame (closes the bubble if the
    // stream is somehow alive), then deliver the content as a fresh markdown
    // message so the reply is not lost.
    if (state.broken || state.acksErr > 0) {
      console.warn(
        `[WeCom] ${connector.name}: stream req=${reqId} looks dead (broken=${state.broken} ackErrs=${state.acksErr} lastErr=${JSON.stringify(state.lastErr)}), falling back to markdown`,
      )
      try {
        flushFrame(state, true)
      } catch {
        // Best-effort — the markdown fallback below is the real delivery.
      }
      clearStream(state)
      await wecomSend(connector, route, chunk.content, replyTo)
      return
    }
    // Final frame must always be sent, regardless of throttle.
    try {
      flushFrame(state, true)
    } finally {
      clearStream(state)
    }
    return
  }

  if (!state) {
    state = {
      connectorId: connector.id,
      connectorName: connector.name,
      routeId: route.id,
      reqId,
      streamId: newStreamId(),
      content: '',
      openedAt: Date.now(),
      lastFlushAt: 0,
      timer: null,
      keepalive: null,
      framesSent: 0,
      acksOk: 0,
      acksErr: 0,
      lastErr: null,
      broken: false,
    }
    streams.set(reqId, state)
    startKeepalive(state)
  }

  // Scheduler sends cumulative snapshots; replace, never append.
  state.content = chunk.content

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
