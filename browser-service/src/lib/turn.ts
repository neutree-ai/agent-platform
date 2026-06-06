import { createHmac } from 'node:crypto'

const TURN_HOST = process.env.TURN_HOST || ''
const TURN_PORT = process.env.TURN_PORT || '3478'
const TURN_SECRET = process.env.TURN_AUTH_SECRET || ''

function generateTurnCredentials(ttlSeconds = 86400) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds
  const username = `${expiry}:sandbox`
  const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64')
  return { username, credential }
}

export function buildIceServers() {
  if (!TURN_HOST || !TURN_SECRET) return null

  const creds = generateTurnCredentials()
  return JSON.stringify([
    {
      urls: [`turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`],
      username: creds.username,
      credential: creds.credential,
    },
  ])
}
