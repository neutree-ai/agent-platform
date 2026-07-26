import type { ApiSchedule } from '../../types/api'
import type { HttpClient } from './http'

export interface CreateJobParams {
  prompt: string
  trigger: { type: string; payload?: unknown }
}

export interface Job {
  id: string
  [key: string]: unknown
}

export type JobSchedule = ApiSchedule

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
    const res = await this.http.fetchJson<{ job: Job }>(
      `/api/workspaces/${workspaceId}/jobs/${jobId}`,
    )
    return res.job
  }

  // Schedules are mounted at /workspaces/:id/schedules, not under /jobs.
  async createSchedule(
    workspaceId: string,
    params: {
      name: string
      /** Exactly one of cron or run_at. */
      cron?: string | null
      run_at?: string | null
      timezone?: string
      prompt?: string
      prompt_id?: string | null
    },
  ): Promise<JobSchedule> {
    const res = await this.http.fetchJson<{ schedule: JobSchedule }>(
      `/api/workspaces/${workspaceId}/schedules`,
      { method: 'POST', body: JSON.stringify(params) },
    )
    return res.schedule
  }

  async listSchedules(workspaceId: string): Promise<JobSchedule[]> {
    const res = await this.http.fetchJson<{ schedules: JobSchedule[] }>(
      `/api/workspaces/${workspaceId}/schedules`,
    )
    return res.schedules
  }

  // Addressed by schedule id — the route has never keyed on name.
  async deleteSchedule(workspaceId: string, scheduleId: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${workspaceId}/schedules/${scheduleId}`, {
      method: 'DELETE',
    })
  }
}
