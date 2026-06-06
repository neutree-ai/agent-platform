import { WebClient } from '@slack/web-api'
import type { Connector, Route } from '../services/db'

export async function slackSend(
  connector: Connector,
  route: Route,
  text: string,
  replyTo?: Record<string, unknown>,
) {
  const creds = connector.credentials as { bot_token?: string }
  if (!creds.bot_token) {
    throw new Error(`Connector ${connector.name}: missing bot_token`)
  }

  const web = new WebClient(creds.bot_token)
  const channel = (replyTo?.channel_id as string) || route.external_id
  await web.chat.postMessage({
    channel,
    text,
    thread_ts: replyTo?.thread_ts as string | undefined,
  })
}

export async function slackSetStatus(
  connector: Connector,
  channelId: string,
  threadTs: string,
  status: string,
) {
  const creds = connector.credentials as { bot_token?: string }
  if (!creds.bot_token) {
    throw new Error(`Connector ${connector.name}: missing bot_token`)
  }

  const web = new WebClient(creds.bot_token)
  await web.apiCall('assistant.threads.setStatus', {
    channel_id: channelId,
    thread_ts: threadTs,
    status,
  })
}
