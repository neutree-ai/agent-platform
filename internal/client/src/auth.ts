import type { ApiUser } from '../../types/api'
import type { HttpClient } from './http'

export class AuthApi {
  constructor(private http: HttpClient) {}

  async login(username: string, password: string): Promise<ApiUser> {
    const res = await this.http.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const match = setCookie.match(/token=([^;]+)/)
      if (match) this.http.setToken(match[1])
    }
    return res.json()
  }

  async logout(): Promise<void> {
    await this.http.fetch('/api/auth/logout', { method: 'POST' })
  }

  async me(): Promise<ApiUser> {
    return this.http.fetchJson('/api/auth/me')
  }

  async updateDefaultPrompt(promptId: string | null): Promise<void> {
    await this.http.fetch('/api/auth/me/default-prompt', {
      method: 'PUT',
      body: JSON.stringify({ prompt_id: promptId }),
    })
  }
}
