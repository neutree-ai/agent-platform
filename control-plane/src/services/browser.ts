// Browser-service HTTP client
// Env: BROWSER_SERVICE_URL (default: http://nap-browser:3005)

const BROWSER_SERVICE_URL = process.env.BROWSER_SERVICE_URL || 'http://nap-browser:3005'

interface BrowserSession {
  id: string
  status: string
  expires_at: string
  created_at: string
  endpoints?: {
    cdp: string | null
    live_view: string | null
  }
}

// Per-request timeout for cp → browser-service control-plane calls. Generous:
// these are all short metadata operations, not browser provisioning waits.
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(token: string, path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method ?? 'GET'
  const fetchOnce = () =>
    fetch(`${BROWSER_SERVICE_URL}${path}`, {
      ...opts,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...opts?.headers,
      },
    })

  // A fetch() rejection means no HTTP response was received (DNS/TCP failure,
  // abort, timeout) — the request never completed, carries no side effect, and
  // is safe to retry once. `e.cause` holds undici's errno/syscall detail.
  // An HTTP error response (!res.ok) reached the server and is NOT retried.
  let res: Response
  try {
    res = await fetchOnce()
  } catch (e: any) {
    console.error(
      `[browser-service] ${method} ${path} fetch failed, retrying once: ${e?.message} | cause:`,
      e?.cause ?? e,
    )
    try {
      res = await fetchOnce()
    } catch (e2: any) {
      console.error(
        `[browser-service] ${method} ${path} fetch failed again: ${e2?.message} | cause:`,
        e2?.cause ?? e2,
      )
      throw e2
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[browser-service] ${method} ${path} → ${res.status}: ${body}`)
    throw new Error(`Browser service ${res.status}: ${body}`)
  }
  return res.json()
}

export async function createBrowser(
  token: string,
  opts?: { timeout_seconds?: number; metadata?: Record<string, string> },
): Promise<BrowserSession> {
  return request<BrowserSession>(token, '/api/browsers', {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  })
}

export async function listBrowsers(
  token: string,
  metadata?: Record<string, string>,
): Promise<{ items: BrowserSession[] }> {
  const params = new URLSearchParams()
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      params.set(`metadata.${k}`, v)
    }
  }
  const qs = params.toString()
  return request<{ items: BrowserSession[] }>(token, `/api/browsers${qs ? `?${qs}` : ''}`)
}

export async function getBrowser(token: string, id: string): Promise<BrowserSession> {
  return request<BrowserSession>(token, `/api/browsers/${id}`)
}

export async function renewBrowser(
  token: string,
  id: string,
  timeoutSeconds?: number,
): Promise<{ expires_at: string }> {
  return request<{ expires_at: string }>(token, `/api/browsers/${id}/renew`, {
    method: 'POST',
    body: JSON.stringify({ timeout_seconds: timeoutSeconds }),
  })
}

export async function deleteBrowser(token: string, id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(token, `/api/browsers/${id}`, {
    method: 'DELETE',
  })
}

export async function getCdpVersion(
  token: string,
  id: string,
): Promise<{ webSocketDebuggerUrl?: string }> {
  return request<{ webSocketDebuggerUrl?: string }>(token, `/cdp/${id}/json/version`)
}

interface BrowserFileInfo {
  path: string
  size?: number
  modifiedAt?: string
  createdAt?: string
  mode?: number
}

export async function listFiles(
  token: string,
  id: string,
  path: string,
  pattern?: string,
): Promise<BrowserFileInfo[]> {
  const params = new URLSearchParams({ path })
  if (pattern) params.set('pattern', pattern)
  const result = await request<{ files: BrowserFileInfo[] }>(
    token,
    `/api/browsers/${id}/files?${params.toString()}`,
  )
  return result.files
}

/**
 * Build a browser-service URL that downloads a file using the given token via
 * the `?token=` fallback. Lets agents hand a clickable download link to the
 * end user without going through MCP for the bytes.
 */
export function buildFileDownloadUrl(token: string, id: string, path: string): string {
  const params = new URLSearchParams({ path, token })
  return `${BROWSER_SERVICE_URL}/api/browsers/${id}/files/content?${params.toString()}`
}
