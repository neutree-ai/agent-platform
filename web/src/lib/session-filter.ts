/**
 * View filter for the session list.
 *
 * Every facet is applied server-side. The list is paginated, so a client-side
 * filter would only narrow the pages already fetched — in a workspace whose
 * sessions are mostly scheduled runs, that returns a near-empty list while
 * infinite scroll keeps paging.
 */

/** Coarse status buckets, matching how the list classifies `chat_status`. */
export type SessionStatusBucket = 'human' | 'agent' | 'idle'

export const SESSION_STATUS_BUCKETS: SessionStatusBucket[] = ['human', 'agent', 'idle']

/** Time window, evaluated against `last_active_at`. */
export type SessionTimeWindow = 'any' | 'today' | '7d' | '30d'

export const SESSION_TIME_WINDOWS: SessionTimeWindow[] = ['any', 'today', '7d', '30d']

export interface SessionFilter {
  /**
   * Sources to leave out. Stored as an exclusion set — not the sources to
   * keep — so a filter saved today can't hide a connector type that ships
   * tomorrow.
   */
  excludedSources: string[]
  /** Statuses to keep. Empty means all; never stores the full set. */
  statuses: SessionStatusBucket[]
  time: SessionTimeWindow
  starredOnly: boolean
}

export const EMPTY_SESSION_FILTER: SessionFilter = {
  excludedSources: [],
  statuses: [],
  time: 'any',
  starredOnly: false,
}

/**
 * Coerces a persisted filter back into shape. The value round-trips through
 * `workspace_profile` jsonb, so it can be older than this build — a missing
 * facet must read as "not filtering", never as undefined leaking into a query.
 */
export function normalizeSessionFilter(
  raw: Partial<SessionFilter> | undefined | null,
): SessionFilter {
  return {
    excludedSources: Array.isArray(raw?.excludedSources) ? raw.excludedSources : [],
    statuses: Array.isArray(raw?.statuses)
      ? raw.statuses.filter((s): s is SessionStatusBucket =>
          SESSION_STATUS_BUCKETS.includes(s as SessionStatusBucket),
        )
      : [],
    time: SESSION_TIME_WINDOWS.includes(raw?.time as SessionTimeWindow)
      ? (raw?.time as SessionTimeWindow)
      : 'any',
    starredOnly: raw?.starredOnly === true,
  }
}

/**
 * How many facets deviate from the default. Drives the badge on the filter
 * button — a number needs no translation and stays correct as facets are
 * added, unlike a generated summary of what is currently hidden.
 */
export function activeFacetCount(f: SessionFilter): number {
  return (
    (f.excludedSources.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.time !== 'any' ? 1 : 0) +
    (f.starredOnly ? 1 : 0)
  )
}

/** Normalizes a status selection: keeping everything is the same as no filter. */
export function normalizeStatuses(next: SessionStatusBucket[]): SessionStatusBucket[] {
  return next.length === SESSION_STATUS_BUCKETS.length ? [] : next
}

/**
 * Start of the window as an ISO instant, or undefined for 'any'.
 *
 * Snapped to a local day boundary: the value lands in a react-query key, and
 * a rolling millisecond would invalidate the list on every render.
 */
export function timeWindowStart(window: SessionTimeWindow, now = new Date()): string | undefined {
  if (window === 'any') return undefined
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (window === '7d') start.setDate(start.getDate() - 6)
  if (window === '30d') start.setDate(start.getDate() - 29)
  return start.toISOString()
}
