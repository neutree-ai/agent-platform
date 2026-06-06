import { Gauge, Histogram } from 'prom-client'

// ── SSE ──

// SSE stream gauges are derived on scrape from the live `activeStreams` map
// in `sse.ts`, never hand-incremented — a manual counter drifts because a
// stream's `dec()` only fires when `runTurn` resolves, which a silently-dead
// agent can defer for up to the 24h idle timeout. `sse.ts` installs the
// provider via `setSseStreamCountProvider` at import time; the fallback keeps
// `/metrics` working if it is scraped before that runs.
interface SseStreamCounts {
  /** Turns in progress: session.started seen, session.ended not yet. */
  active: number
  /** Every live stream object, including finished turns awaiting reclaim. */
  open: number
}
let sseStreamCounts: () => SseStreamCounts = () => ({ active: 0, open: 0 })
export function setSseStreamCountProvider(fn: () => SseStreamCounts): void {
  sseStreamCounts = fn
}

// Both gauges register with the prom-client default registry on construction;
// the /metrics endpoint enumerates that registry, so neither needs an exported
// binding. Values are derived on every scrape via collect().
new Gauge({
  name: 'tos_sse_active_streams',
  help: 'Number of agent turns in progress (session.started seen, not yet ended)',
  collect() {
    this.set(sseStreamCounts().active)
  },
})

// open_streams - active_streams is the count of finished turns whose stream
// object hasn't been reclaimed yet — i.e. zombie-stream candidates.
new Gauge({
  name: 'tos_sse_open_streams',
  help: 'Number of live SSE stream objects (includes finished turns awaiting reclaim)',
  collect() {
    this.set(sseStreamCounts().open)
  },
})

export const sseStreamDuration = new Histogram({
  name: 'tos_sse_stream_duration_seconds',
  help: 'Duration of SSE streams (full agent turn)',
  buckets: [5, 15, 30, 60, 120, 300, 600, 1800],
})

// ── HTTP ──

export const httpRequestDuration = new Histogram({
  name: 'tos_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
})

export const httpActiveRequests = new Gauge({
  name: 'tos_http_active_requests',
  help: 'Number of in-flight HTTP requests',
})

// ── DB ──

export const dbQueryDuration = new Histogram({
  name: 'tos_db_query_duration_seconds',
  help: 'Database query duration',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
})
