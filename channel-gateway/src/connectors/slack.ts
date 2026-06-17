import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import pMap from 'p-map'
import { TosClient } from '../../../internal/client/src/index'
import * as db from '../services/db'

const NAP_API_URL = process.env.NAP_API_URL || 'http://localhost:3000'

/** Extract plain text from a Slack event/message, falling back to attachments then blocks
 *  when the top-level text field is empty (rich-text / Block Kit messages). */
export function extractSlackText(msg: Record<string, unknown>): string {
  let raw = (msg.text as string) || ''
  if (!raw) {
    const atts = (
      msg as {
        attachments?: Array<{
          fallback?: string
          text?: string
          pretext?: string
          title?: string
        }>
      }
    ).attachments
    if (atts?.length) {
      raw = atts
        .map((a) => [a.pretext, a.title, a.text, a.fallback].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('\n')
    }
  }
  if (!raw) {
    const blocks = (msg as { blocks?: Array<{ type?: string; text?: { text?: string } }> }).blocks
    if (blocks?.length) {
      raw = blocks
        .map((b) => b.text?.text || '')
        .filter(Boolean)
        .join('\n')
    }
  }
  return raw
}
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

type SlackImage = { data: string; media_type: string; filename?: string }

/** Active socket connections keyed by connector ID */
const activeConnectors = new Map<string, SocketModeClient>()

/** Start all enabled Slack connectors (called once at startup) */
export async function startAll() {
  const connectors = await db.getConnectorsByType('slack')
  if (connectors.length === 0) {
    console.log('[Slack] Skipped: no slack connectors configured')
    return
  }
  await Promise.all(
    connectors.map((c) =>
      startOne(c.id).catch((e) => console.error(`[Slack] Failed to start connector ${c.id}:`, e)),
    ),
  )
}

/** Start a single connector by ID. No-op if already running. */
export async function startOne(connectorId: string) {
  if (activeConnectors.has(connectorId)) {
    console.log(`[Slack] Connector ${connectorId} already running, skipping`)
    return
  }

  const connectorRow = await db.getConnector(connectorId)
  if (!connectorRow || connectorRow.type !== 'slack' || !connectorRow.enabled) {
    console.log(`[Slack] Connector ${connectorId} not found, not slack, or disabled`)
    return
  }
  // Copy to const for use in closures (avoids TS null narrowing issues)
  const connector = connectorRow

  const creds = connector.credentials as { app_token?: string; bot_token?: string }
  if (!creds.app_token || !creds.bot_token) {
    console.log(`[Slack] Skipped connector ${connector.name}: missing app_token or bot_token`)
    return
  }

  const platformToken = await db.getPlatformToken(connector.user_id)
  if (!platformToken) {
    console.log(
      `[Slack] Skipped connector ${connector.name}: no platform token for user=${connector.user_id}`,
    )
    return
  }

  const tosClient = new TosClient({
    baseUrl: NAP_API_URL,
    serviceToken: platformToken,
  })

  const web = new WebClient(creds.bot_token)
  const socket = new SocketModeClient({
    appToken: creds.app_token,
    pingPongLoggingEnabled: true,
    clientPingTimeout: 30000,
    serverPingTimeout: 30000,
  })

  // Get bot user ID to detect mentions
  let botUserId: string | null = null
  try {
    const auth = await web.auth.test()
    botUserId = auth.user_id as string
    console.log(`[Slack] ${connector.name}: bot user ID ${botUserId}`)
    // Persist team URL in system metadata for permalink generation
    if (auth.url) {
      await db.updateConnectorMetadata(connector.id, { team_url: auth.url })
    }
  } catch (e) {
    console.error(`[Slack] ${connector.name}: failed to get bot user ID:`, e)
  }

  async function downloadSlackImage(file: {
    mimetype?: string
    url_private?: string
    name?: string
  }): Promise<SlackImage | null> {
    if (!file.url_private || !file.mimetype || !SUPPORTED_IMAGE_TYPES.has(file.mimetype)) {
      return null
    }
    try {
      const res = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${creds.bot_token}` },
      })
      if (!res.ok) {
        console.warn(`[Slack] ${connector.name}: failed to download ${file.name}: ${res.status}`)
        return null
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { data: buf.toString('base64'), media_type: file.mimetype, filename: file.name }
    } catch (e) {
      console.warn(`[Slack] ${connector.name}: error downloading ${file.name}:`, e)
      return null
    }
  }

  function imageMarker(index: number, image: SlackImage): string {
    const filename = image.filename ? ` filename="${image.filename.replaceAll('"', '&quot;')}"` : ''
    return `<image index="${index}"${filename} />`
  }

  function appendImageMarkers(text: string, images: SlackImage[], startIndex: number): string {
    if (images.length === 0) return text
    const markers = images.map((img, i) => imageMarker(startIndex + i, img)).join('\n')
    return [text.trim(), markers].filter(Boolean).join('\n')
  }

  function imageReminder(totalImages: number): string {
    if (totalImages <= 1) return ''
    return `<image_reminder>
Attached images are referenced by <image index="N" /> markers in the text above and below.
Indexes are 1-based and match the attached images order.
</image_reminder>

`
  }

  /** Fetch thread history and format as context string, downloading any images in parallel.
   *  When `oldest` is provided, only messages after that timestamp are returned (incremental context). */
  async function fetchThreadContext(
    channel: string,
    threadTs: string,
    currentTs: string,
    oldest?: string,
  ): Promise<{ context: string; images: SlackImage[] }> {
    try {
      const result = await web.conversations.replies({
        channel,
        ts: threadTs,
        limit: 50,
        ...(oldest ? { oldest } : {}),
      })
      const messages = result.messages || []
      // Exclude the current message and system subtypes (channel_join, etc.)
      // Keep bot_message so thread history from other bots is visible as context
      const IGNORED_SUBTYPES = new Set([
        'channel_join',
        'channel_leave',
        'channel_topic',
        'channel_purpose',
        'channel_name',
        'channel_archive',
        'channel_unarchive',
        'group_join',
        'group_leave',
        'group_topic',
        'group_purpose',
        'group_name',
        'group_archive',
        'group_unarchive',
        'pinned_item',
        'unpinned_item',
      ])
      const history = messages.filter((m) => {
        if (m.ts === currentTs) return false
        const subtype = (m as { subtype?: string }).subtype
        if (subtype && IGNORED_SUBTYPES.has(subtype)) return false
        // When fetching incrementally, Slack always returns the parent message
        // regardless of `oldest`. Filter out messages at or before the cursor.
        if (oldest && Number.parseFloat(m.ts!) <= Number.parseFloat(oldest)) return false
        return true
      })
      if (history.length === 0) return { context: '', images: [] }

      const messagesWithImages = await pMap(
        history,
        async (m) => {
          const who = m.bot_id ? 'bot' : `user(<@${m.user}>)`
          const raw = extractSlackText(m as unknown as Record<string, unknown>)

          // Download images from history messages
          const files = (
            m as { files?: Array<{ mimetype?: string; url_private?: string; name?: string }> }
          ).files
          const images = files?.length
            ? (await pMap(files, downloadSlackImage, { concurrency: 8 })).filter(
                (img): img is SlackImage => img !== null,
              )
            : []

          const body = botUserId
            ? raw.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim()
            : raw.trim()
          return { line: `[${who}] ${body}`, images }
        },
        { concurrency: 4 },
      ) // Run message processing 4 at a time to avoid overwhelming Slack API

      const allImages: SlackImage[] = []
      const lines = messagesWithImages.map(({ line, images }) => {
        const withMarkers = appendImageMarkers(line, images, allImages.length + 1)
        allImages.push(...images)
        return withMarkers
      })

      return {
        context: `<thread_context>\n${lines.join('\n')}\n</thread_context>\n\n`,
        images: allImages,
      }
    } catch (e) {
      console.error(`[Slack] ${connector.name}: failed to fetch thread context:`, e)
      return { context: '', images: [] }
    }
  }

  /** Download image attachments from a Slack event and return them as base64 chunks the chat API accepts.
   *  Slack `files[].url_private` requires the bot token to download. Anthropic supports
   *  jpeg/png/gif/webp; other types (PDF, etc.) are skipped here. */
  async function fetchImageAttachments(event: Record<string, unknown>): Promise<SlackImage[]> {
    const files = event.files as
      | Array<{ mimetype?: string; url_private?: string; name?: string }>
      | undefined
    if (!files?.length) return []
    return (await pMap(files, downloadSlackImage, { concurrency: 8 })).filter(
      (img): img is SlackImage => img !== null,
    )
  }

  interface SlackAudioFile {
    url_private?: string
    mimetype?: string
    name?: string
    transcription?: { status?: string; preview?: { content?: string } }
  }

  /** Transcribe a single Slack audio file. Prefers Slack's built-in transcript
   *  (Pro+ workspace) when available; otherwise downloads and forwards to the
   *  cp ASR endpoint. */
  async function transcribeSlackAudio(
    file: SlackAudioFile,
  ): Promise<{ text: string | null; error: string | null }> {
    const builtin =
      file.transcription?.status === 'complete' ? file.transcription.preview?.content?.trim() : null
    if (builtin) return { text: builtin, error: null }

    if (!file.url_private) return { text: null, error: 'audio file has no url' }
    try {
      const res = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${creds.bot_token}` },
      })
      if (!res.ok) return { text: null, error: `download failed: ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      const result = await tosClient.asr.transcribe(buf, {
        filename: file.name || 'voice.m4a',
        contentType: file.mimetype || 'audio/mp4',
      })
      const text = result.text?.trim() || ''
      if (!text) return { text: null, error: 'Empty transcript.' }
      return { text, error: null }
    } catch (e) {
      return { text: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Walk the event's files[] and transcribe any audio entries. Returns the
   *  collected transcripts and the first error encountered (so the caller can
   *  surface it as an explicit reply). */
  async function fetchVoiceTranscriptions(
    event: Record<string, unknown>,
  ): Promise<{ texts: string[]; error: string | null }> {
    const files = event.files as SlackAudioFile[] | undefined
    if (!files?.length) return { texts: [], error: null }
    const audioFiles = files.filter((f) => f.mimetype?.startsWith('audio/'))
    if (!audioFiles.length) return { texts: [], error: null }
    const texts: string[] = []
    for (const f of audioFiles) {
      const r = await transcribeSlackAudio(f)
      if (r.error) return { texts, error: r.error }
      if (r.text) texts.push(r.text)
    }
    return { texts, error: null }
  }

  /** Resolve route for a channel, falling back to wildcard. */
  async function resolveRoute(channel: string) {
    const route = await db.getRouteByExternalId(connector.id, channel)
    return route || db.getRouteByExternalId(connector.id, '*')
  }

  /** Create a job for the given event and route. Shared by app_mention and message handlers. */
  async function dispatchJob(event: Record<string, unknown>, route: db.Route) {
    const channel = event.channel as string
    const text = extractSlackText(event)
    const user = event.user as string
    const messageTs = event.ts as string
    const threadTs = (event.thread_ts || event.ts) as string

    // Atomic dedup: claim this messageTs before doing any work.
    // If another handler (app_mention vs message) already claimed it, bail out.
    const eventId = await db.claimEvent({
      route_id: route.id,
      connector_id: connector.id,
      event_type: 'mention',
      payload: { user, thread_ts: threadTs, text },
      dedup_key: messageTs,
    })
    if (!eventId) {
      console.log(`[Slack] ${connector.name}: dedup skip messageTs=${messageTs}`)
      return
    }

    let cleanText = botUserId ? text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim() : text

    const images = await fetchImageAttachments(event)

    // Voice clips: prefer Slack's built-in transcript, otherwise fall back to
    // our ASR endpoint. Failure aborts the dispatch with an explicit reply so
    // the user knows it didn't go through.
    const voice = await fetchVoiceTranscriptions(event)
    if (voice.error) {
      await web.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: `Voice transcription failed: ${voice.error}\nPlease retry, or type your message.`,
        })
        .catch((e) =>
          console.warn(
            `[Slack] ${connector.name}: failed to send transcription-error reply:`,
            e instanceof Error ? e.message : e,
          ),
        )
      return
    }
    if (voice.texts.length) {
      cleanText = [cleanText, ...voice.texts].filter(Boolean).join('\n')
    }

    // Chat API requires non-empty message; substitute a placeholder when the user sent only images.
    if (!cleanText && images.length) cleanText = '[image]'

    // Fetch thread history as context (only if this is a reply in a thread).
    // If an existing session is found, use last_active_at as cursor to fetch only
    // incremental messages (bystander messages the agent hasn't seen).
    let threadContext = ''
    let threadImages: SlackImage[] = []
    if (event.thread_ts) {
      const cursor = await db.getThreadSessionCursor(route.id, threadTs)
      const result = await fetchThreadContext(channel, threadTs, messageTs, cursor ?? undefined)
      threadContext = result.context
      threadImages = result.images
    }

    const promptTemplate = (route.config as Record<string, unknown>)?.prompt as string | undefined

    console.log(
      `[Slack] ${connector.name}: triggering job: channel=${channel} user=${user} workspace=${route.workspace_id}`,
    )

    // Set assistant thread status immediately
    try {
      await web.apiCall('assistant.threads.setStatus', {
        channel_id: channel,
        thread_ts: threadTs,
        status: 'is processing your request...',
      })
    } catch (e) {
      console.warn(`[Slack] ${connector.name}: failed to set thread status:`, e)
    }

    cleanText = appendImageMarkers(cleanText, images, threadImages.length + 1)
    const allImages = [...threadImages, ...images]
    if (threadContext) threadContext += imageReminder(allImages.length)
    // Chat API requires non-empty message; substitute a placeholder when the user sent only images.
    if (!cleanText && allImages.length) cleanText = '[image]'

    // Create the job as the route owner (route.user_id), not the connector
    // owner. The job targets route.workspace_id; with a shared connector whose
    // route points at another user's workspace, calling cp as the connector
    // owner gets scoped out → 404 "Workspace not found". Reuse the connector
    // client when owners match to avoid an extra token lookup per message.
    let jobClient = tosClient
    if (route.user_id !== connector.user_id) {
      const routeToken = await db.getPlatformToken(route.user_id)
      if (!routeToken) {
        console.error(
          `[Slack] ${connector.name}: no platform token for route owner=${route.user_id}`,
        )
        return
      }
      jobClient = new TosClient({ baseUrl: NAP_API_URL, serviceToken: routeToken })
    }

    try {
      const result = await jobClient.jobs.create(route.workspace_id, {
        prompt: cleanText,
        trigger: {
          type: 'slack',
          payload: {
            connector_id: connector.id,
            route_id: route.id,
            user,
            session_ttl_hours: (route.config as Record<string, unknown>)?.session_ttl_hours ?? 24,
            reply_context: { thread_id: threadTs, thread_ts: threadTs, channel_id: channel },
            thread_context: threadContext || undefined,
            prompt_template: promptTemplate || undefined,
            template_vars: { user, thread_ts: threadTs, channel },
            images: allImages.length
              ? allImages.map(({ data, media_type }) => ({ data, media_type }))
              : undefined,
          },
        },
      })
      console.log(`[Slack] ${connector.name}: job created: ${result.id}`)

      await db.updateEvent(eventId, { job_id: result.id, status: 'success' })
    } catch (e) {
      console.error(`[Slack] ${connector.name}: failed to create job:`, e)

      await db.updateEvent(eventId, {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // --- app_mention: always triggers a job (existing behavior) ---
  socket.on('app_mention', async ({ event, ack }) => {
    await ack()
    if (event.bot_id || event.subtype) return

    const channel = event.channel as string
    const route = await resolveRoute(channel)
    if (!route) {
      console.log(`[Slack] ${connector.name}: no route for channel=${channel}, ignoring`)
      return
    }
    await dispatchJob(event, route)
  })

  // --- message: auto-follow in threads when require_mention is false ---
  socket.on('message', async ({ event, ack }) => {
    await ack()
    if (event.bot_id || event.subtype) return

    // Only handle thread replies (not top-level messages)
    const threadTs = event.thread_ts as string | undefined
    if (!threadTs || threadTs === event.ts) return

    const channel = event.channel as string
    const route = await resolveRoute(channel)
    if (!route) return

    // Only active when require_mention is explicitly false
    const routeConfig = route.config as Record<string, unknown>
    if (routeConfig?.require_mention !== false) return

    // Skip (aside) messages
    const text = ((event.text as string) || '').trimStart()
    if (text.startsWith('(aside)')) return

    // Only auto-follow if bot has an active session in this thread
    const cursor = await db.getThreadSessionCursor(route.id, threadTs)
    if (!cursor) return

    console.log(`[Slack] ${connector.name}: auto-follow in thread=${threadTs} channel=${channel}`)
    await dispatchJob(event, route)
  })

  await socket.start()
  activeConnectors.set(connector.id, socket)
  console.log(`[Slack] ${connector.name}: connected`)
}

/** Stop a single connector by ID. No-op if not running. */
export async function stopOne(connectorId: string) {
  const socket = activeConnectors.get(connectorId)
  if (!socket) return
  try {
    await socket.disconnect()
  } catch (e) {
    console.error(`[Slack] Error disconnecting connector ${connectorId}:`, e)
  }
  activeConnectors.delete(connectorId)
  console.log(`[Slack] Connector ${connectorId}: disconnected`)
}

/** Restart a connector (stop then start). Used after credentials/config change. */
export async function restartOne(connectorId: string) {
  await stopOne(connectorId)
  await startOne(connectorId)
}
