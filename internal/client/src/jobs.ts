import type { HttpClient } from './http'

export interface CreateJobParams {
  prompt: string
  trigger: { type: string; payload?: unknown }
}

export interface Job {
  id: string
  [key: string]: unknown
}

export interface JobSchedule {
  name: string
  [key: string]: unknown
}

export class JobsApi {
  constructor(private http: HttpClient) {}

  async create(workspaceId: string, params: CreateJobParams): Promise<{ id: string }> {
    return this.http.fetchJson(`/api/workspaces/${workspaceId}/jobs`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async list(workspaceId: string): Promise<Job[]> {
    const res = await this.http.fetchJson<{ jobs: Job[] }>(`/api/workspaces/${workspaceId}/jobs`)
    return res.jobs
  }

  async get(workspaceId: string, jobId: string): Promise<Job> {
    const res = await this.http.fetchJson<{ job: Job }>(`/api/workspaces/${workspaceId}/jobs/${jobId}`)
    return res.job
  }

  async createSchedule(workspaceId: string, params: Record<string, unknown>): Promise<JobSchedule> {
    return this.http.fetchJson(`/api/workspaces/${workspaceId}/jobs/schedules`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async listSchedules(workspaceId: string): Promise<JobSchedule[]> {
    const res = await this.http.fetchJson<{ schedules: JobSchedule[] }>(`/api/workspaces/${workspaceId}/jobs/schedules`)
    return res.schedules
  }

  async deleteSchedule(workspaceId: string, name: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${workspaceId}/jobs/schedules/${name}`, {
      method: 'DELETE',
    })
  }
}
