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

export interface SandboxSession {
  id: string
  status: { state: string; reason?: string; message?: string }
  image?: { uri: string }
  metadata?: Record<string, string>
  expiresAt?: string
  createdAt?: string
}

export const api = {
  getMe: () => request<User>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  listSandboxes: () => request<{ items: SandboxSession[] }>('/api/sandboxes'),
  getSandbox: (id: string) => request<SandboxSession>(`/api/sandboxes/${id}`),
  createSandbox: (opts: {
    image: string
    resource?: { cpu?: string; memory?: string }
    timeoutSeconds?: number
  }) =>
    request<SandboxSession>('/api/sandboxes', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  renewSandbox: (id: string, timeoutSeconds?: number) =>
    request<{ expiresAt: string }>(`/api/sandboxes/${id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ timeoutSeconds }),
    }),
  deleteSandbox: (id: string) =>
    request<{ success: boolean }>(`/api/sandboxes/${id}`, { method: 'DELETE' }),
}
