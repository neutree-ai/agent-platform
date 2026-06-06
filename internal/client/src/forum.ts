import { HttpClient } from './http'
import type { HttpClientOptions } from './http'

// ── Types ──

export interface ForumThread {
  id: string
  title: string
  body: string
  author_id: string
  author_username: string
  author_name: string
  reply_count: number
  is_pinned: boolean
  labels: string[]
  created_at: string
  updated_at: string
}

export interface ForumReply {
  id: string
  thread_id: string
  body: string
  author_id: string
  author_username: string
  author_name: string
  created_at: string
  updated_at: string
}

export interface ForumThreadDetail extends ForumThread {
  replies: ForumReply[]
}

export interface ForumUser {
  id: string
  username: string
  name: string
}

// ── Client ──

export class ForumClient {
  private http: HttpClient

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options)
  }

  // Auth
  async me(): Promise<ForumUser> {
    return this.http.fetchJson('/api/auth/me')
  }

  // Threads
  async listThreads(opts?: { limit?: number; offset?: number; search?: string; sort?: string; label?: string }): Promise<ForumThread[]> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    if (opts?.search) params.set('search', opts.search)
    if (opts?.sort) params.set('sort', opts.sort)
    if (opts?.label) params.set('label', opts.label)
    const qs = params.toString()
    return this.http.fetchJson(`/api/threads${qs ? `?${qs}` : ''}`)
  }

  async getThread(id: string): Promise<ForumThreadDetail> {
    return this.http.fetchJson(`/api/threads/${id}`)
  }

  async createThread(data: { title: string; body: string; labels?: string[]; label?: string; author_id?: string }): Promise<ForumThread> {
    return this.http.fetchJson('/api/threads', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateThread(id: string, data: { title?: string; body?: string; labels?: string[]; label?: string | null }): Promise<ForumThread> {
    return this.http.fetchJson(`/api/threads/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteThread(id: string): Promise<void> {
    await this.http.fetch(`/api/threads/${id}`, { method: 'DELETE' })
  }

  async togglePin(id: string): Promise<ForumThread> {
    return this.http.fetchJson(`/api/threads/${id}/pin`, { method: 'POST' })
  }

  // Replies
  async createReply(threadId: string, data: { body: string; author_id?: string }): Promise<ForumReply> {
    return this.http.fetchJson(`/api/threads/${threadId}/replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateReply(id: string, data: { body: string }): Promise<ForumReply> {
    return this.http.fetchJson(`/api/replies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteReply(id: string): Promise<void> {
    await this.http.fetch(`/api/replies/${id}`, { method: 'DELETE' })
  }

  // Images
  async uploadImage(file: Blob, filename?: string): Promise<{ id: string; url: string; size: number }> {
    const formData = new FormData()
    formData.append('file', file, filename || 'image.png')

    return this.http.fetchJson('/api/images', {
      method: 'POST',
      body: formData,
    })
  }
}
