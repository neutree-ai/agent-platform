import type { HttpClient } from './http'

export interface CreateBatchRunParams {
  name?: string
  concurrency?: number
  tasks: { workspace_id: string; prompt: string }[]
}

export interface BatchRun {
  id: string
  name: string
  user_id: string
  status: string
  concurrency: number
  stats: BatchRunStats | null
  created_at: string
  completed_at: string | null
}

export interface BatchTask {
  id: string
  batch_run_id: string
  workspace_id: string
  prompt: string
  status: string
  session_id: string | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface BatchRunStats {
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  total_cost_usd: number
  total_duration_ms: number
}

export interface BatchRunDetail extends BatchRun {
  tasks: BatchTask[]
}

export class BatchRunsApi {
  constructor(private http: HttpClient) {}

  async create(params: CreateBatchRunParams): Promise<BatchRun> {
    return this.http.fetchJson('/api/batch-runs', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async list(): Promise<BatchRun[]> {
    const res = await this.http.fetchJson<{ batch_runs: BatchRun[] }>('/api/batch-runs')
    return res.batch_runs
  }

  async get(id: string): Promise<BatchRunDetail> {
    return this.http.fetchJson(`/api/batch-runs/${id}`)
  }

  async cancel(id: string): Promise<void> {
    await this.http.fetch(`/api/batch-runs/${id}`, { method: 'DELETE' })
  }
}
