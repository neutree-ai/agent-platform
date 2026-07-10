import crypto from 'node:crypto'
import WebSocket from 'ws'
import { NapClient } from '../../../internal/client/src/index'
import * as db from '../services/db'
import { wecomSend, wecomSendStream } from './wecom-sender'

const NAP_API_URL = process.env.NAP_API_URL || 'http://localhost:3000'
const WS_URL = 'wss://openws.work.weixin.qq.com'
// App-level liveness: re-issue aibot_subscribe every minute and expect its
// response within 10s. WeCom's WS path through our IDC egress drops control
// frames (PING/PONG) but passes data frames, so liveness has to ride on a
// real app-level round-trip. Tolerate 2 consecutive missed responses (one
// data frame loss is plausible) before terminating.
const HEARTBEAT_INTERVAL_MS = 60_000
const HEARTBEAT_RESPONSE_TIMEOUT_MS = 10_000
const HEARTBEAT_MAX_CONSECUTIVE_MISSED = 2

// WeCom errcodes that won't recover by reconnecting — stop trying so we
// don't get IP-banned hammering openws with bad credentials.
const PERMANENT_SUBSCRIBE_ERRCODES = new Set([
  853000, // invalid bot_id or secret
])

/** Active WebSocket connections keyed by connector ID */
const activeConnectors = new Map<string, WebSocket>()

/** Get active WebSocket for a connector (used by wecom-sender) */
export function getSocket(connectorId: string): WebSocket | undefined {
  return activeConnectors.get(connectorId)
}

/** Start all enabled WeCom connectors (called once at startup) */
export async function startAll() {
  const connectors = await db.getConnectorsByType('wecom')
  if (connectors.length === 0) {
    console.log('[WeCom] Skipped: no wecom connectors configured')
    return
  }
  await Promise.all(
    connectors.map((c) =>
      startOne(c.id).catch((e) => console.error(`[WeCom] Failed to start connector ${c.id}:`, e)),
    ),
  )
}

/** Start a single connector by ID. No-op if already running. */
export async function startOne(connectorId: string) {
  if (activeConnectors.has(connectorId)) {
    console.log(`[WeCom] Connector ${connectorId} already running, skipping`)
    return
  }

  const connectorRow = await db.getConnector(connectorId)
  if (!connectorRow || connectorRow.type !== 'wecom' || !connectorRow.enabled) {
    console.log(`[WeCom] Connector ${connectorId} not found, not wecom, or disabled`)
    return
  }
  const connector = connectorRow

  const creds = connector.credentials as { bot_id?: string; secret?: string }
  if (!creds.bot_id || !creds.secret) {
    console.log(`[WeCom] Skipped connector ${connector.name}: missing bot_id or secret`)
    return
  }

  const platformToken = await db.getPlatformToken(connector.user_id)
  if (!platformToken) {
    console.log(
      `[WeCom] Skipped connector ${connector.name}: no platform token for user=${connector.user_id}`,
    )
    return
  }

  const napClient = new NapClient({
    baseUrl: NAP_API_URL,
    serviceToken: platformToken,
  })

  function connect() {
    console.log(`[WeCom] ${connector.name}: connecting to ${WS_URL}...`)
    const ws = new WebSocket(WS_URL)
    // pendingSubscribes maps req_id -> { kind, timer }. Initial subscribe and
    // each heartbeat re-subscribe register here; matching response by req_id
    // clears the entry. If the response timer fires first, the connection is
    // considered dead and torn down — onclose's reconnect path takes over.
    const pendingSubscribes = new Map<
      string,
      { kind: 'initial' | 'heartbeat'; timer: ReturnType<typeof setTimeout> }
    >()
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let consecutiveMissedHeartbeats = 0
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      for (const { timer } of pendingSubscribes.values()) clearTimeout(timer)
      pendingSubscribes.clear()
    }

    const sendSubscribe = (kind: 'initial' | 'heartbeat') => {
      const reqId = `${kind === 'initial' ? 'sub' : 'hb'}_${Date.now()}`
      const timer = setTimeout(() => {
        pendingSubscribes.delete(reqId)
        if (kind === 'heartbeat') {
          consecutiveMissedHeartbeats++
          if (consecutiveMissedHeartbeats < HEARTBEAT_MAX_CONSECUTIVE_MISSED) {
            console.warn(
              `[WeCom] ${connector.name}: heartbeat ${reqId} missed (${consecutiveMissedHeartbeats}/${HEARTBEAT_MAX_CONSECUTIVE_MISSED}), tolerating`,
            )
            return
          }
        }
        console.warn(
          `[WeCom] ${connector.name}: ${kind} subscribe ${reqId} no response in ${HEARTBEAT_RESPONSE_TIMEOUT_MS}ms, terminating`,
        )
        try {
          ws.terminate()
        } catch {}
      }, HEARTBEAT_RESPONSE_TIMEOUT_MS)
      pendingSubscribes.set(reqId, { kind, timer })
      try {
        ws.send(
          JSON.stringify({
            cmd: 'aibot_subscribe',
            headers: { req_id: reqId },
            body: { bot_id: creds.bot_id, secret: creds.secret },
          }),
        )
      } catch (e) {
        clearTimeout(timer)
        pendingSubscribes.delete(reqId)
        console.warn(`[WeCom] ${connector.name}: ${kind} subscribe send failed:`, e)
      }
    }

    ws.onopen = () => {
      console.log(`[WeCom] ${connector.name}: connected, sending aibot_subscribe...`)
      sendSubscribe('initial')
      heartbeatTimer = setInterval(() => sendSubscribe('heartbeat'), HEARTBEAT_INTERVAL_MS)
    }

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : event.data.toString()
      let frame: any
      try {
        frame = JSON.parse(raw)
      } catch {
        console.log(`[WeCom] ${connector.name}: non-JSON message:`, raw)
        return
      }

      // Match subscribe response by req_id. WeCom's response shape is
      // {headers:{req_id}, errcode, errmsg} — no top-level cmd field.
      const reqId = frame.headers?.req_id
      if (reqId && pendingSubscribes.has(reqId)) {
        const pending = pendingSubscribes.get(reqId)!
        clearTimeout(pending.timer)
        pendingSubscribes.delete(reqId)
        if (frame.errcode !== 0) {
          console.error(
            `[WeCom] ${connector.name}: ${pending.kind} subscribe failed errcode=${frame.errcode} errmsg=${frame.errmsg}`,
          )
          if (PERMANENT_SUBSCRIBE_ERRCODES.has(frame.errcode)) {
            console.error(
              `[WeCom] ${connector.name}: errcode is non-retryable, disabling connector until pod restart`,
            )
            // Removing from activeConnectors makes onclose's reconnect path
            // skip this connector — no more 3s loop hammering WeCom.
            activeConnectors.delete(connector.id)
          }
          try {
            ws.terminate()
          } catch {}
        } else {
          consecutiveMissedHeartbeats = 0
          if (pending.kind === 'initial') {
            console.log(`[WeCom] ${connector.name}: subscribed successfully`)
          }
        }
        return
      }

      if (frame.cmd === 'aibot_msg_callback') {
        handleMessage(connector, napClient, ws, frame).catch((e) =>
          console.error(`[WeCom] ${connector.name}: error handling message:`, e),
        )
      }
    }

    ws.onclose = (event) => {
      stopHeartbeat()
      console.log(
        `[WeCom] ${connector.name}: disconnected: code=${event.code} reason=${event.reason}`,
      )
      // Only reconnect if still in activeConnectors (not manually stopped)
      if (activeConnectors.has(connector.id)) {
        console.log(`[WeCom] ${connector.name}: reconnecting in 3s...`)
        setTimeout(() => {
          if (activeConnectors.has(connector.id)) {
            connect()
          }
        }, 3000)
      }
    }

    ws.onerror = (event) => {
      console.error(`[WeCom] ${connector.name}: WebSocket error:`, event)
    }

    activeConnectors.set(connector.id, ws)
  }

  connect()
  console.log(`[WeCom] ${connector.name}: started`)
}

/** Download a WeCom aibot media URL and decrypt with the segment's `aesKey` if
 *  any. Returns the raw decrypted bytes; callers decide how to interpret them
 *  (image sniff, audio passthrough to ASR, etc.). */
async function downloadMedia(url: string, aesKey?: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = Buffer.from(await res.arrayBuffer())
  if (!aesKey) return raw
  return decryptAibotFile(raw, aesKey) as Buffer
}

/** Download + decrypt as image. Sniffs the byte signature because COS serves
 *  it as application/octet-stream; returns null when format is unsupported. */
async function downloadImage(
  url: string,
  aesKey?: string,
): Promise<{ data: string; media_type: string } | null> {
  const buf = await downloadMedia(url, aesKey)
  const sniffed = sniffImageType(buf)
  if (!sniffed) {
    const head = buf.slice(0, 32).toString('hex')
    console.warn(
      `[WeCom] image bytes don't match a supported image format (len=${buf.length}, head_hex=${head}), skipping`,
    )
    return null
  }
  return { data: buf.toString('base64'), media_type: sniffed }
}

/** Decrypt a WeCom aibot media file. AES-256-CBC; key = base64-decoded aesKey
 *  (32 bytes), IV = first 16 bytes of the decoded key, PKCS#7 padding to a
 *  32-byte block. Mirrors the official aibot-node-sdk. */
function decryptAibotFile(buf: Buffer, aesKeyBase64: string): Buffer {
  const key = Buffer.from(aesKeyBase64, 'base64')
  const iv = key.subarray(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(buf), decipher.final()])
  const padLen = decrypted[decrypted.length - 1]
  if (padLen < 1 || padLen > 32 || padLen > decrypted.length) {
    throw new Error(`Invalid PKCS#7 padding: ${padLen}`)
  }
  return decrypted.subarray(0, decrypted.length - padLen)
}

/** Detect image type from the first bytes. Returns an Anthropic-supported
 *  media_type (jpeg/png/gif/webp) or null. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'image/webp'
  return null
}

async function handleMessage(
  connector: db.Connector,
  napClient: NapClient,
  ws: WebSocket,
  frame: any,
) {
  const { body, headers } = frame
  const reqId = headers?.req_id
  const msgType = body?.msgtype
  const from = body?.from?.userid || 'unknown'
  // WeCom aibot only sends `chatid` for group chats; single (1:1) chats omit
  // it. Falling back to a constant collapses every user's private chat into
  // one session — key private chats by sender userid instead.
  const chatType = body?.chattype as 'single' | 'group' | undefined
  const chatId = chatType === 'single' ? `user:${from}` : body?.chatid || 'unknown'

  let content = ''
  const images: Array<{ data: string; media_type: string }> = []
  let voiceError: string | null = null
  let hadVoiceSeg = false

  // Extract a media URL + aesKey from a WeCom segment regardless of shape. The
  // aibot protocol nests fields under `.<kind>` (e.g. `image.url`, `voice.url`)
  // but on mixed segments they may appear at the segment root as well.
  const extractMediaRef = (
    seg: any,
    kind: 'image' | 'voice',
  ): { url: string; aesKey?: string } | null => {
    const url = seg?.[kind]?.url || seg?.url
    if (!url) return null
    const aesKey = seg?.[kind]?.aeskey || seg?.aeskey
    return { url, aesKey }
  }

  const tryDownloadImage = async (ref: { url: string; aesKey?: string }) => {
    const fetched = await downloadImage(ref.url, ref.aesKey).catch((e) => {
      console.warn(`[WeCom] ${connector.name}: failed to download image:`, e)
      return null
    })
    if (fetched) images.push(fetched)
  }

  /** Download + transcribe a voice segment. Returns transcript text on success;
   *  on failure stores the message in `voiceError` (handler decides whether to
   *  abort) and returns null. Caller is responsible for marking `hadVoiceSeg`
   *  before invoking — that flag is set the moment we identify a voice msg,
   *  regardless of whether the URL was extractable. */
  const tryTranscribeVoice = async (ref: { url: string; aesKey?: string }): Promise<
    string | null
  > => {
    try {
      const buf = await downloadMedia(ref.url, ref.aesKey)
      const result = await napClient.asr.transcribe(buf, { filename: 'voice.amr' })
      const text = result.text?.trim() ?? ''
      if (!text) {
        voiceError = 'Empty transcript.'
        return null
      }
      return text
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[WeCom] ${connector.name}: voice transcription failed:`, msg)
      voiceError = msg
      return null
    }
  }

  if (msgType === 'text') {
    content = body.text?.content || ''
  } else if (msgType === 'image') {
    const ref = extractMediaRef(body, 'image')
    if (ref) await tryDownloadImage(ref)
    content = images.length ? '[image]' : `[${msgType} message]`
  } else if (msgType === 'voice') {
    hadVoiceSeg = true
    // WeCom aibot now ships the server-side ASR result inline as `voice.content`.
    // Prefer it; fall back to downloading + transcribing the audio ourselves
    // when only `voice.url` is present (older payload shape).
    const inlineText = body?.voice?.content?.trim?.()
    if (inlineText) {
      content = inlineText
    } else {
      const ref = extractMediaRef(body, 'voice')
      if (!ref) {
        console.warn(
          `[WeCom] ${connector.name}: voice msg had no content or url, body=`,
          JSON.stringify(body).slice(0, 500),
        )
        voiceError = 'Voice payload missing content and url.'
      } else {
        const text = await tryTranscribeVoice(ref)
        if (text) content = text
      }
    }
  } else if (msgType === 'mixed') {
    // WeCom mixed payload: a list of heterogeneous segments. We've seen both
    // `body.mixed.msg_item` and `body.mixed_message` in docs; support both.
    const segments: any[] =
      (Array.isArray(body.mixed?.msg_item) && body.mixed.msg_item) ||
      (Array.isArray(body.mixed) && body.mixed) ||
      (Array.isArray(body.mixed_message) && body.mixed_message) ||
      []
    if (!segments.length) {
      console.warn(
        `[WeCom] ${connector.name}: mixed msg had no segments, body=`,
        JSON.stringify(body).slice(0, 500),
      )
    }
    const textParts: string[] = []
    for (const seg of segments) {
      const segType = seg?.msgtype || seg?.type
      if (segType === 'text') {
        const t = seg?.text?.content || seg?.content
        if (t) textParts.push(t)
      } else if (segType === 'image') {
        const ref = extractMediaRef(seg, 'image')
        if (ref) await tryDownloadImage(ref)
      } else if (segType === 'voice') {
        hadVoiceSeg = true
        const inlineText = seg?.voice?.content?.trim?.()
        if (inlineText) {
          textParts.push(inlineText)
          continue
        }
        const ref = extractMediaRef(seg, 'voice')
        if (!ref) {
          voiceError = voiceError || 'Voice payload missing content and url.'
          continue
        }
        const text = await tryTranscribeVoice(ref)
        if (text) textParts.push(text)
      }
    }
    content = textParts.join('\n') || (images.length ? '[image]' : '[mixed message]')
  } else {
    console.log(
      `[WeCom] ${connector.name}: unhandled msgtype=${msgType} body=`,
      JSON.stringify(body),
    )
    content = `[${msgType} message]`
  }

  console.log(
    `[WeCom] ${connector.name}: message from=${from} chat=${chatId} type=${msgType}: ${content} images=${images.length}`,
  )

  // Find route by chat ID
  let route = await db.getRouteByExternalId(connector.id, chatId)
  if (!route) route = await db.getRouteByExternalId(connector.id, '*')
  if (!route) {
    console.log(`[WeCom] ${connector.name}: no route for chat=${chatId}, ignoring`)
    return
  }

  // Voice transcription failure → reply error and abort. Do this only when a
  // voice segment was actually present; otherwise voiceError stays null.
  if (hadVoiceSeg && voiceError) {
    const replyText = `Voice transcription failed: ${voiceError}\nPlease retry, or type your message.`
    await wecomSend(connector, route, replyText, { req_id: reqId, chat_id: chatId }).catch((e) =>
      console.warn(
        `[WeCom] ${connector.name}: failed to send transcription-error reply:`,
        e instanceof Error ? e.message : e,
      ),
    )
    return
  }

  // Strip leading bot mention only. Avoid global match so `@` elsewhere in the
  // body (emails, user mentions) survives intact.
  const cleanText = content.replace(/^@\S+\s+/, '').trim()

  // Guard against empty prompt (cp would 400). Happens when an inbound message
  // had no extractable text — e.g. voice extraction failed silently above. The
  // voice-error reply already covers the recognised cases; this is a backstop.
  if (!cleanText && !images.length) {
    console.warn(
      `[WeCom] ${connector.name}: empty message after content extraction, type=${msgType}`,
    )
    return
  }

  // Intercept /new before dispatching: clear the thread_session so the next
  // turn starts a fresh agent session, then acknowledge in-chat.
  if (cleanText === '/new') {
    const cleared = await db.deleteThreadSession(route.id, chatId)
    console.log(`[WeCom] ${connector.name}: /new from=${from} chat=${chatId} cleared=${cleared}`)
    try {
      await wecomSend(connector, route, cleared ? 'New session started.' : 'No active session.', {
        chat_id: chatId,
        req_id: reqId,
      })
    } catch (e) {
      console.warn(`[WeCom] ${connector.name}: failed to ack /new:`, e)
    }
    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'mention',
      payload: { user: from, chat_id: chatId, text: content, command: '/new', cleared },
      status: 'success',
    })
    return
  }

  const promptTemplate = (route.config as Record<string, unknown>)?.prompt as string | undefined
  // Expose sender / chat metadata to the agent. The aibot WS callback only
  // ships `from.userid` (no name/email), so {user} is the most specific
  // identity we can surface.
  const templateVars: Record<string, string> = {
    user: from,
    channel: chatId,
    chat_type: chatType ?? 'unknown',
  }

  console.log(
    `[WeCom] ${connector.name}: triggering job: chat=${chatId} user=${from} workspace=${route.workspace_id}`,
  )

  // WeCom passive-reply window expires 5s after the inbound callback. Job creation
  // → scheduler pickup → first agent token easily blows that, so always claim
  // the bubble with a placeholder stream frame regardless of route.config.streaming.
  // For streaming routes, subsequent cumulative snapshots from the scheduler
  // overwrite the placeholder. For non-streaming routes, the final reply is
  // delivered as a stream-finish frame (see routes/send.ts wecom branch).
  try {
    await wecomSendStream(
      connector,
      route,
      { req_id: reqId, chat_id: chatId },
      { content: 'Thinking…', finish: false },
    )
  } catch (e) {
    console.warn(
      `[WeCom] ${connector.name}: failed to send placeholder stream frame:`,
      e instanceof Error ? e.message : e,
    )
  }

  // Create the job as the route owner (route.user_id), not the connector owner.
  // The job targets route.workspace_id; with a shared connector whose route
  // points at another user's workspace, calling cp as the connector owner gets
  // scoped out → 404 "Workspace not found". Reuse the connector client when
  // owners match to avoid an extra token lookup per message.
  let jobClient = napClient
  if (route.user_id !== connector.user_id) {
    const routeToken = await db.getPlatformToken(route.user_id)
    if (!routeToken) {
      console.error(`[WeCom] ${connector.name}: no platform token for route owner=${route.user_id}`)
      return
    }
    jobClient = new NapClient({ baseUrl: NAP_API_URL, serviceToken: routeToken })
  }

  try {
    const result = await jobClient.jobs.create(route.workspace_id, {
      prompt: cleanText,
      trigger: {
        type: 'wecom',
        payload: {
          connector_id: connector.id,
          route_id: route.id,
          user: from,
          chat_type: chatType ?? 'unknown',
          session_ttl_hours: (route.config as Record<string, unknown>)?.session_ttl_hours ?? 24,
          reply_context: {
            chat_id: chatId,
            req_id: reqId,
            thread_id: chatId,
            streaming: (route.config as Record<string, unknown>)?.streaming === true,
          },
          prompt_template: promptTemplate || undefined,
          template_vars: templateVars,
          images: images.length ? images : undefined,
        },
      },
    })
    console.log(`[WeCom] ${connector.name}: job created: ${result.id}`)

    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'mention',
      payload: { user: from, chat_id: chatId, text: content },
      job_id: result.id,
      status: 'success',
    })
  } catch (e) {
    console.error(`[WeCom] ${connector.name}: failed to create job:`, e)

    await db.logEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'mention',
      payload: { user: from, chat_id: chatId, text: content },
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/** Stop all active connectors (called on shutdown) */
export async function stopAll() {
  const ids = [...activeConnectors.keys()]
  for (const id of ids) {
    await stopOne(id)
  }
}

/** Stop a single connector by ID. No-op if not running. */
export async function stopOne(connectorId: string) {
  const ws = activeConnectors.get(connectorId)
  if (!ws) return
  activeConnectors.delete(connectorId) // Delete first to prevent reconnect
  try {
    ws.close()
  } catch (e) {
    console.error(`[WeCom] Error closing connector ${connectorId}:`, e)
  }
  console.log(`[WeCom] Connector ${connectorId}: disconnected`)
}

/** Restart a connector (stop then start). Used after credentials/config change. */
export async function restartOne(connectorId: string) {
  await stopOne(connectorId)
  await startOne(connectorId)
}
