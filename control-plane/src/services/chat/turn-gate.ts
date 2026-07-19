// Unified turn admission for every workspace turn.
//
// Every turn — from web, API, teamwork, connector, scheduler, or a drained
// follow-up — passes through here before it reaches the agent (acquireTurn at
// the top of executeChat, released when the turn ends). It does two jobs:
//
//   1. Account: track how many turns each workspace is running concurrently.
//      This is the demand signal the autoscaler reads (added with the
//      autoscaler); it is also the base a load-aware replica pick will use.
//   2. Admit: cap concurrency for AUTO-SCALING workspaces at
//      readyReplicas × target, queueing (bounded, with timeout) over the cap.
//
// A static (single-replica) workspace has no reported ready set, so its capacity
// is Infinity: preview ACCOUNTS its turns but never blocks — existing single-pod
// behavior is byte-unchanged. Enforcement is therefore reachable only for an
// auto-scaling workspace, and none can exist yet, so the gate is dormant beyond
// its (harmless) counter. Shape is told apart the same way the router does it —
// by the reported ready set, not runtime_mode — so there is no dependency on the
// config columns that gate creation.
//
// cp is single-process, so a plain in-memory counter + FIFO queue is the whole
// coordination primitive; no distributed locking.

import { readyReplicaCount } from '../replica-router'

// Target concurrent sessions per replica for capacity sizing. The per-workspace
// value (workspace_config.target_sessions_per_replica) lands with the
// auto-scaling config stage; until then this env-overridable default stands in.
const DEFAULT_TARGET_SESSIONS_PER_REPLICA = Number(process.env.TURN_GATE_DEFAULT_TARGET) || 3

// How many turns may queue per workspace before new arrivals are rejected
// outright instead of queued — bounds memory and worst-case latency under load.
const MAX_QUEUE_PER_WS = Number(process.env.TURN_GATE_MAX_QUEUE) || 50

// How long a queued turn waits for a slot before giving up (→ 503).
const QUEUE_TIMEOUT_MS = Number(process.env.TURN_GATE_QUEUE_TIMEOUT_MS) || 30_000

/** Per-workspace count of turns currently holding a slot. */
const activeTurns = new Map<string, number>()

interface Waiter {
  grant: () => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}
/** Per-workspace FIFO of turns waiting for a slot (auto-scaling only). */
const waiters = new Map<string, Waiter[]>()

/** Raised when a workspace is at capacity and the queue is full or timed out. */
export class TurnCapacityError extends Error {
  constructor(workspaceId: string) {
    super(`workspace ${workspaceId} is at turn capacity`)
    this.name = 'TurnCapacityError'
  }
}

/** A held admission slot. `release()` is idempotent. */
export interface TurnSlot {
  release(): void
}

/**
 * A workspace's concurrency ceiling right now. Static (no ready replicas) →
 * Infinity, so preview accounts but never blocks. Auto-scaling → readyReplicas ×
 * target, so the cap grows and shrinks with the live replica count.
 */
function capacityOf(workspaceId: string): number {
  const ready = readyReplicaCount(workspaceId)
  if (ready === 0) return Number.POSITIVE_INFINITY
  return ready * DEFAULT_TARGET_SESSIONS_PER_REPLICA
}

function decrement(workspaceId: string): void {
  const n = (activeTurns.get(workspaceId) ?? 1) - 1
  if (n <= 0) activeTurns.delete(workspaceId)
  else activeTurns.set(workspaceId, n)
}

function makeSlot(workspaceId: string): TurnSlot {
  let released = false
  return {
    release() {
      if (released) return
      released = true
      decrement(workspaceId)
      drain(workspaceId)
    },
  }
}

/** Grant queued waiters while spare capacity exists (a slot freed, or the cap grew). */
function drain(workspaceId: string): void {
  const q = waiters.get(workspaceId)
  if (!q || q.length === 0) return
  while (q.length > 0 && (activeTurns.get(workspaceId) ?? 0) < capacityOf(workspaceId)) {
    const w = q.shift() as Waiter
    clearTimeout(w.timer)
    activeTurns.set(workspaceId, (activeTurns.get(workspaceId) ?? 0) + 1)
    w.grant()
  }
  if (q.length === 0) waiters.delete(workspaceId)
}

/**
 * Admit one turn against a workspace, resolving to a slot the caller releases
 * when the turn ends. Fast path (under capacity, or any static workspace)
 * resolves synchronously-ish; over an auto-scaling workspace's capacity it
 * queues (bounded + timeout) and rejects with {@link TurnCapacityError} when the
 * queue is full or the wait elapses.
 */
export function acquireTurn(workspaceId: string): Promise<TurnSlot> {
  const active = activeTurns.get(workspaceId) ?? 0
  if (active < capacityOf(workspaceId)) {
    activeTurns.set(workspaceId, active + 1)
    return Promise.resolve(makeSlot(workspaceId))
  }

  // Over capacity — only reachable for an auto-scaling workspace (static is
  // Infinity). Queue behind a bound; the slot is handed over by drain(), which
  // has already incremented the active count on this workspace's behalf.
  const q = waiters.get(workspaceId) ?? []
  if (q.length >= MAX_QUEUE_PER_WS) return Promise.reject(new TurnCapacityError(workspaceId))
  return new Promise<TurnSlot>((resolve, reject) => {
    const w: Waiter = {
      grant: () => resolve(makeSlot(workspaceId)),
      reject,
      timer: setTimeout(() => {
        const arr = waiters.get(workspaceId)
        const i = arr?.indexOf(w) ?? -1
        if (arr && i >= 0) {
          arr.splice(i, 1)
          if (arr.length === 0) waiters.delete(workspaceId)
        }
        reject(new TurnCapacityError(workspaceId))
      }, QUEUE_TIMEOUT_MS),
    }
    q.push(w)
    waiters.set(workspaceId, q)
  })
}

/** Test seam: drop all admission state (and pending timers). */
export function __resetTurnGate(): void {
  for (const q of waiters.values()) for (const w of q) clearTimeout(w.timer)
  waiters.clear()
  activeTurns.clear()
}
