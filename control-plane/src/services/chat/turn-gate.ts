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
//      readyReplicas × per-replica capacity, making turns over the cap wait for
//      a slot (as the scheduler already does for per-workspace concurrency),
//      with a bounded queue as a flood backstop.
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

// Concurrent turns one replica carries — the per-replica capacity. This is the
// workspace's own max_concurrency (workspace_config.max_concurrency, the same
// per-workspace knob the scheduler already caps concurrent jobs with, default
// 3): one replica carries what the single static pod carried. That per-workspace
// value is read in with the config stage; this constant is only the dormant
// fallback until then (no auto-scaling workspace can exist yet to reach it).
const FALLBACK_SESSIONS_PER_REPLICA = Number(process.env.TURN_GATE_FALLBACK_TARGET) || 3

// How many turns may queue per workspace before new arrivals are rejected
// outright instead of queued — a memory backstop against a flood, nothing more.
const MAX_QUEUE_PER_WS = Number(process.env.TURN_GATE_MAX_QUEUE) || 50

/** Per-workspace count of turns currently holding a slot. */
const activeTurns = new Map<string, number>()

interface Waiter {
  grant: () => void
  /** Only used by {@link __resetTurnGate} to unstick pending promises in tests. */
  reject: (e: Error) => void
}
/** Per-workspace FIFO of turns waiting for a slot (auto-scaling only). */
const waiters = new Map<string, Waiter[]>()

/** Raised when a workspace is at capacity and its wait queue is already full. */
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
 * per-replica capacity, so the cap grows and shrinks with the live replica count.
 */
function capacityOf(workspaceId: string): number {
  const ready = readyReplicaCount(workspaceId)
  if (ready === 0) return Number.POSITIVE_INFINITY
  return ready * FALLBACK_SESSIONS_PER_REPLICA
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
    activeTurns.set(workspaceId, (activeTurns.get(workspaceId) ?? 0) + 1)
    w.grant()
  }
  if (q.length === 0) waiters.delete(workspaceId)
}

/**
 * Admit one turn against a workspace, resolving to a slot the caller releases
 * when the turn ends. Under capacity (and always for a static workspace) it
 * resolves immediately. Over an auto-scaling workspace's capacity it WAITS for a
 * slot to free — the same "wait for your turn" behavior the scheduler already
 * uses for per-workspace concurrency — resolving as soon as one frees or the cap
 * grows. The only rejection is {@link TurnCapacityError} when the wait queue is
 * already full (a flood backstop), never a timeout: a queued turn is not a
 * failed turn, it is a turn whose replica is coming.
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
    q.push({ grant: () => resolve(makeSlot(workspaceId)), reject })
    waiters.set(workspaceId, q)
  })
}

/** Test seam: drop all admission state, rejecting any still-pending waiters. */
export function __resetTurnGate(): void {
  for (const q of waiters.values()) {
    for (const w of q) w.reject(new TurnCapacityError('__reset__'))
  }
  waiters.clear()
  activeTurns.clear()
}
