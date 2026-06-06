// Browser sandbox lifecycle — calls NAP Sandbox Service

const SANDBOX_SERVICE_URL = process.env.SANDBOX_SERVICE_URL || 'http://nap-sandbox:3006'

const BROWSER_IMAGE = process.env.BROWSER_IMAGE || 'chromium-headful:latest'

import { buildIceServers } from '../lib/turn'

interface SandboxInfo {
  id: string
  status: { state: string; reason?: string; message?: string }
  expiresAt: string
  createdAt: string
  metadata?: Record<string, string>
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.SANDBOX_SERVICE_KEY
  if (key) h['X-Service-Key'] = key
  return h
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${SANDBOX_SERVICE_URL}${path}`, {
    ...opts,
    headers: { ...headers(), ...opts?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Sandbox service ${res.status}: ${body}`)
  }
  return res.json() as T
}

export async function createBrowser(
  userId: string,
  opts?: {
    timeoutSeconds?: number
    resource?: Record<string, string>
    metadata?: Record<string, string>
  },
): Promise<SandboxInfo> {
  const iceservers = buildIceServers()

  const env: Record<string, string> = {
    ENABLE_WEBRTC: 'true',
    WITH_KERNEL_IMAGES_API: 'true',
    CHROMIUM_FLAGS: '--enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-webgl',
  }

  if (iceservers) {
    env.NEKO_WEBRTC_ICELITE = 'true'
    env.NEKO_WEBRTC_ICESERVERS_FRONTEND = iceservers
    env.NEKO_WEBRTC_ICESERVERS_BACKEND = iceservers
    env.NEKO_WEBRTC_IP_RETRIEVAL_URL = 'http://0.0.0.0/none'
  }

  return api<SandboxInfo>('/api/sandboxes', {
    method: 'POST',
    body: JSON.stringify({
      image: BROWSER_IMAGE,
      timeoutSeconds: opts?.timeoutSeconds ?? 3600,
      entrypoint: ['/wrapper.sh'],
      resource: opts?.resource ?? { cpu: '2', memory: '2Gi' },
      env,
      ownerId: userId,
      metadata: {
        'browser.user_id': userId,
        'browser.service': 'tos',
        ...opts?.metadata,
      },
    }),
  })
}

export async function listBrowsers(
  userId: string,
  metadata?: Record<string, string>,
): Promise<{ items: SandboxInfo[] }> {
  const result = await api<{ items: SandboxInfo[] }>(
    `/api/sandboxes?metadata.browser.user_id=${encodeURIComponent(userId)}`,
  )
  // Always verify browser.user_id matches (server filter may return extra results)
  result.items = result.items.filter((s) => s.metadata?.['browser.user_id'] === userId)
  if (metadata) {
    result.items = result.items.filter((s) =>
      Object.entries(metadata).every(([k, v]) => s.metadata?.[k] === v),
    )
  }
  return result
}

export async function getBrowser(sandboxId: string): Promise<SandboxInfo> {
  return api<SandboxInfo>(`/api/sandboxes/${sandboxId}`)
}

export async function deleteBrowser(sandboxId: string): Promise<void> {
  await api(`/api/sandboxes/${sandboxId}`, { method: 'DELETE' })
}

export async function renewBrowser(
  sandboxId: string,
  timeoutSeconds = 3600,
): Promise<{ expiresAt: string }> {
  return api<{ expiresAt: string }>(`/api/sandboxes/${sandboxId}/renew`, {
    method: 'POST',
    body: JSON.stringify({ timeoutSeconds }),
  })
}

interface SandboxFileInfo {
  path: string
  size?: number
  modifiedAt?: string
  createdAt?: string
  mode?: number
  owner?: string
  group?: string
}

export async function listFiles(
  sandboxId: string,
  path: string,
  pattern?: string,
): Promise<SandboxFileInfo[]> {
  const params = new URLSearchParams({ path })
  if (pattern) params.set('pattern', pattern)
  const result = await api<{ files: SandboxFileInfo[] }>(
    `/api/sandboxes/${sandboxId}/files/list?${params.toString()}`,
  )
  return result.files
}

/**
 * Streams raw file bytes from sandbox-service. Caller is responsible for
 * consuming or cancelling the body. Forwards an optional `Range` header and
 * preserves response status (200 / 206 / 416).
 */
export async function fetchFileRaw(
  sandboxId: string,
  path: string,
  range?: string,
): Promise<Response> {
  const params = new URLSearchParams({ path })
  const url = `${SANDBOX_SERVICE_URL}/api/sandboxes/${sandboxId}/files/raw?${params.toString()}`
  const h = headers()
  if (range) h.Range = range
  return fetch(url, { headers: h })
}

export async function getEndpoint(sandboxId: string, port: number): Promise<{ endpoint: string }> {
  const result = await api<{ url: string }>(`/api/sandboxes/${sandboxId}/endpoint/${port}`)
  // Extract host from full URL for proxy compatibility
  const parsed = new URL(result.url)
  return { endpoint: parsed.host + parsed.pathname }
}
