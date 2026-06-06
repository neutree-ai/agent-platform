async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed: ${res.status}`)
  }

  return res.json()
}

export interface User {
  id: string
  username: string
  name: string
}

export interface BrowserSession {
  id: string
  sandbox_id: string
  status: string
  image: string
  timeout_seconds: number
  expires_at: string
  created_at: string
  endpoints?: {
    cdp: string | null
    live_view: string | null
    recording: string | null
  }
}

export const api = {
  getMe: () => request<User>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  listBrowsers: () => request<{ items: BrowserSession[] }>('/api/browsers'),
  getBrowser: (id: string) => request<BrowserSession>(`/api/browsers/${id}`),
  createBrowser: (opts?: { timeout_seconds?: number }) =>
    request<BrowserSession>('/api/browsers', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  renewBrowser: (id: string, timeout_seconds?: number) =>
    request<{ expires_at: string }>(`/api/browsers/${id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ timeout_seconds }),
    }),
  deleteBrowser: (id: string) =>
    request<{ success: boolean }>(`/api/browsers/${id}`, { method: 'DELETE' }),
}
