import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'
import pMap from 'p-map'
import { NapClient } from '../../../internal/client/src/index'
import { cancelThreadTurn } from '../lib/cancel-command'
import { resolveRouteClient } from '../lib/route-client'
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
type SlackFile = { id?: string; mimetype?: string; url_private?: string; name?: string }

export function genericSlackFiles(files: SlackFile[] | undefined): SlackFile[] {
  return (files || []).filter(
    (file) =>
      !SUPPORTED_IMAGE_TYPES.has(file.mimetype || '') && !file.mimetype?.startsWith('audio/'),
  )
}

export function slackAttachmentPath(file: SlackFile): string | null {
  if (!file.id) return null
  const segment = (value: string, fallback: string) =>
    value.replace(/[\/\\]|\p{Cc}/gu, '_').replace(/^\.+/, '') || fallback
  return `.attachments/slack/${segment(file.id, 'file')}/${segment(file.name || 'attachment', 'attachment')}`
}

export function appendAttachmentPaths(text: string, paths: string[], failures: string[]): string {
  if (!paths.length && !failures.length) return text
  return [
    text.trim(),
    '<attachments>',
    ...paths.map((path) => `- /workspace/${path}`),
    ...failures.map((failure) => `- [failed] ${failure}`),
    '</attachments>',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Flatten a fetch rejection into something a human can act on.
 *
 *  undici rejects with a bare `TypeError: fetch failed` and puts the part that
 *  identifies the failure — `EAI_AGAIN`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`,
 *  a certificate error — on `cause`, sometimes nested one level further. Report
 *  just the message and DNS/TLS/socket triage is impossible after the fact. */
function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const parts = [e.message]
  let cause: unknown = e.cause
  for (let depth = 0; depth < 3 && cause instanceof Error; depth++) {
    const code = (cause as NodeJS.ErrnoException).code
    parts.push(code ? `${code}: ${cause.message}` : cause.message)
    cause = cause.cause
  }
  return parts.join(' <- ')
}

/** Attempts per Slack file download, and the budget for one attempt to produce
 *  response headers. */
const SLACK_FETCH_ATTEMPTS = 3
const SLACK_FETCH_HEADERS_TIMEOUT_MS = 4000

/** Fetch a Slack-hosted file, retrying when no response headers arrive in time.
 *
 *  `files.slack.com` resolves to several CloudFront addresses, and a rotating
 *  subset of them is blackholed from our egress — the SYN draws no reply rather
 *  than a refusal, so an attempt that picks one stalls until undici's 10s
 *  connect timeout and then fails outright. Measured from the cluster, roughly
 *  a quarter of connections landed on a dead address, and undici does not fall
 *  back to another address once it has committed to one.
 *
 *  Each attempt is therefore bounded well below that connect timeout and simply
 *  retried; a fresh attempt re-resolves and normally lands somewhere healthy,
 *  so three short tries beat one long one on both success rate and latency.
 *
 *  The timer covers DNS, connect, TLS and headers only — it is cleared the
 *  moment `fetch` resolves, so a large body still streams without a deadline. */
async function fetchSlackFile(url: URL | string, botToken: string, label: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= SLACK_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SLACK_FETCH_HEADERS_TIMEOUT_MS)
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: controller.signal,
      })
    } catch (e) {
      lastError = controller.signal.aborted
        ? new Error(`no response within ${SLACK_FETCH_HEADERS_TIMEOUT_MS}ms`)
        : e
      console.warn(
        `[Slack] ${label}: download attempt ${attempt}/${SLACK_FETCH_ATTEMPTS} failed: ${describeFetchError(lastError)}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export async function stageGenericFiles(
  files: SlackFile[],
  client: NapClient,
  workspaceId: string,
  botToken: string,
): Promise<{ paths: string[]; failures: string[] }> {
  const paths: string[] = []
  const failures: string[] = []
  for (const file of files) {
    const name = file.name || file.id || 'attachment'
    const path = slackAttachmentPath(file)
    if (!path || !file.url_private) {
      failures.push(`${name} — attachment download failed: missing file id or URL`)
      continue
    }
    let fileUrl: URL
    try {
      fileUrl = new URL(file.url_private)
    } catch {
      failures.push(`${name} — attachment download failed: invalid file URL`)
      continue
    }
    // Gate on the origin Slack hands us, so the bot token is only ever offered
    // to Slack. This checks the URL we request, not the one the bytes finally
    // come from: an authenticated `files.slack.com` request 302s to
    // `slack-files.com`, which is a different registrable domain and is not
    // covered here. That redirect is followed automatically, and the fetch spec
    // drops `Authorization` when a redirect crosses origins, so the token stays
    // with Slack either way — but the transfer itself reaches a host this
    // allow-list never saw. Egress policy has to account for both names.
    if (
      fileUrl.protocol !== 'https:' ||
      (fileUrl.hostname !== 'slack.com' && !fileUrl.hostname.endsWith('.slack.com'))
    ) {
      failures.push(`${name} — attachment download failed: untrusted file URL`)
      continue
    }
    let response: Response
    try {
      response = await fetchSlackFile(fileUrl, botToken, `${name} (${fileUrl.host})`)
    } catch (e) {
      const detail = describeFetchError(e)
      console.warn(`[Slack] attachment download failed for ${name} (${fileUrl.host}): ${detail}`)
      failures.push(`${name} — attachment download failed: ${detail}`)
      continue
    }
    if (!response.ok || !response.body) {
      failures.push(
        `${name} — attachment download failed: ${response.ok ? 'empty response' : response.status}`,
      )
      continue
    }
    if (
      response.headers.get('content-type')?.toLowerCase().startsWith('text/html') &&
      !file.mimetype?.toLowerCase().startsWith('text/html')
    ) {
      failures.push(
        `${name} — attachment download failed: Slack returned an HTML login page; add the files:read bot scope and reinstall the app`,
      )
      continue
    }
    try {
      await client.workspaces.writeFile(
        workspaceId,
        path,
        response.body,
        file.mimetype || 'application/octet-stream',
      )
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
    paths.push(path)
  }
  return { paths, failures }
}

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
  const botToken = creds.bot_token

  const platformToken = await db.getPlatformToken(connector.user_id)
  if (!platformToken) {
    console.log(
      `[Slack] Skipped connector ${connector.name}: no platform token for user=${connector.user_id}`,
    )
    return
  }

  const napClient = new NapClient({
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

  // Channel names are stable enough to cache for the connector's lifetime;
  // lookup failures (e.g. missing scope, DMs) are not cached so they can retry.
  const channelNameCache = new Map<string, string>()
  async function getChannelName(channel: string): Promise<string> {
    const cached = channelNameCache.get(channel)
    if (cached !== undefined) return cached
    try {
      const info = await web.conversations.info({ channel })
      const name = info.channel?.name ?? ''
      channelNameCache.set(channel, name)
      return name
    } catch (e) {
      console.warn(
        `[Slack] ${connector.name}: failed to resolve channel name for ${channel}:`,
        e instanceof Error ? e.message : e,
      )
      return ''
    }
  }

  async function downloadSlackImage(file: SlackFile): Promise<SlackImage | null> {
    if (!file.url_private || !file.mimetype || !SUPPORTED_IMAGE_TYPES.has(file.mimetype)) {
      return null
    }
    try {
      const res = await fetchSlackFile(file.url_private, botToken, file.name || 'image')
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
    const files = event.files as SlackFile[] | undefined
    if (!files?.length) return []
    return (await pMap(files, downloadSlackImage, { concurrency: 8 })).filter(
      (img): img is SlackImage => img !== null,
    )
  }

  interface SlackAudioFile extends SlackFile {
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
      const result = await napClient.asr.transcribe(buf, {
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

  /** Set the assistant thread status indicator. An empty status clears it.
   *  The indicator is otherwise only cleared once a job reports back, so any
   *  path that sets it and then bails without creating a job has to clear it. */
  async function setThreadStatus(channel: string, threadTs: string, status: string) {
    try {
      await web.apiCall('assistant.threads.setStatus', {
        channel_id: channel,
        thread_ts: threadTs,
        status,
      })
    } catch (e) {
      console.warn(`[Slack] ${connector.name}: failed to set thread status:`, e)
    }
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

    // Intercept /cancel before any of the work below — the thread-context
    // fetch, the status update and the image downloads are all wasted for a
    // command, and skipping them also keeps `/cancel` out of the context the
    // agent later reads back.
    //
    // Unlike /new — which WeCom needs because its group chat is one flat
    // conversation — this has no natural equivalent here: starting a new
    // thread sidesteps a running turn but cannot stop it, and abandons the
    // context the user wants to keep.
    if (cleanText === '/cancel') {
      const ack = await cancelThreadTurn(
        `[Slack] ${connector.name}`,
        route,
        connector,
        napClient,
        threadTs,
      )
      if (ack === null) return
      await web.chat
        .postMessage({ channel, thread_ts: threadTs, text: ack })
        .catch((e) => console.warn(`[Slack] ${connector.name}: failed to ack /cancel:`, e))
      return
    }

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

    const jobClient = await resolveRouteClient(
      `[Slack] ${connector.name}`,
      route,
      connector,
      napClient,
    )
    if (!jobClient) return

    // Show progress before attachment staging, which may wait for a workspace cold start.
    await setThreadStatus(channel, threadTs, 'is processing your request...')

    let attachmentPaths: string[] = []
    let attachmentFailures: string[] = []
    try {
      const staged = await stageGenericFiles(
        genericSlackFiles(event.files as SlackFile[] | undefined),
        jobClient,
        route.workspace_id,
        botToken,
      )
      attachmentPaths = staged.paths
      attachmentFailures = staged.failures
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      await setThreadStatus(channel, threadTs, '')
      await web.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: `Attachment staging failed: ${error}\nThe job was not started. Please retry.`,
        })
        .catch((replyError) =>
          console.warn(
            `[Slack] ${connector.name}: failed to send staging-error reply:`,
            replyError,
          ),
        )
      await db
        .updateEvent(eventId, { status: 'error', error })
        .catch((updateError) =>
          console.warn(`[Slack] ${connector.name}: failed to record staging error:`, updateError),
        )
      return
    }
    cleanText = appendAttachmentPaths(cleanText, attachmentPaths, attachmentFailures)

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
    const channelName = await getChannelName(channel)

    console.log(
      `[Slack] ${connector.name}: triggering job: channel=${channel} user=${user} workspace=${route.workspace_id}`,
    )

    cleanText = appendImageMarkers(cleanText, images, threadImages.length + 1)
    const allImages = [...threadImages, ...images]
    if (threadContext) threadContext += imageReminder(allImages.length)
    // Chat API requires non-empty message; substitute a placeholder when the user sent only images.
    if (!cleanText && allImages.length) cleanText = '[image]'

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
            template_vars: { user, thread_ts: threadTs, channel, channel_name: channelName },
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
      await setThreadStatus(channel, threadTs, '')
      await web.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: 'Failed to start the job. Please retry.',
        })
        .catch((replyError) =>
          console.warn(
            `[Slack] ${connector.name}: failed to send job-creation-error reply:`,
            replyError,
          ),
        )
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
    if (event.bot_id) return
    // Messages with attachments arrive as subtype `file_share`; every other
    // subtype (edits, deletions, joins, ...) is not a new user turn.
    if (event.subtype && event.subtype !== 'file_share') return

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
