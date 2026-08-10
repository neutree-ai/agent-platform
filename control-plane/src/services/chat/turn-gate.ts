// Unified turn admission for every workspace turn.
//
// Every turn — from web, API, teamwork, connector, scheduler, or a drained
// follow-up — passes through here before it reaches the agent (acquireTurn at
// the top of executeChat, released when the turn ends). It does two jobs:
//
//   1. Account: track how many turns each workspace is running concurrently.
//      This is the demand signal the autoscaler scales on.
//   2. Admit: cap a workspace at readyReplicas × its per-replica capacity
//      (max_concurrency), making turns over the cap wait for a slot, as the
//      scheduler already does for per-workspace concurrency.
//
// The cap is one rule for every workspace: a running single-replica workspace
// admits max_concurrency turns, and one running three replicas admits three
// times that. max_concurrency therefore means the same thing everywhere — how
// much concurrent work one replica of this workspace may carry, whatever the
// work came in through.
//
// A waiting turn is not a failed turn, so waiting is the normal response to a
// full workspace. It is bounded twice, because a workspace whose capacity cannot
// grow has nothing to wait FOR beyond its own turns finishing: by queue depth (a
// flood backstop) and by time (a stuck agent must not silently freeze every
// caller behind it). Both give up with a 503 the caller can retry.
//
// cp is single-process, so a plain in-memory counter + FIFO queue is the whole
// coordination primitive; no distributed locking.

import { perReplicaCapacity, readyReplicaCount } from '../replica-router'

// How many turns may queue per workspace before new arrivals are rejected
// outright instead of queued — a memory backstop against a flood, nothing more.
const MAX_QUEUE_PER_WS = Number(process.env.TURN_GATE_MAX_QUEUE) || 50

// How long a turn may wait for a slot before giving up. Generous, because the
// wait is legitimate — it is bounded only so a stuck turn cannot hold its
// workspace's callers indefinitely with no answer.
const MAX_WAIT_MS = Number(process.env.TURN_GATE_MAX_WAIT_MS) || 120_000

/** Per-workspace count of turns currently holding a slot. */
const activeTurns = new Map<string, number>()

interface Waiter {
  grant: () => void
  reject: (e: Error) => void
  /** Fires when this turn has waited long enough; cleared once it is granted. */
  timer: ReturnType<typeof setTimeout>
}
/** Per-workspace FIFO of turns waiting for a slot. */
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
 * A workspace's concurrency ceiling right now: ready replicas × its own
 * per-replica capacity, sized entirely from the replica router's live snapshot
 * with no gate-side constant, so the cap follows the live replica count.
 *
 * A workspace cp cannot size — none reported ready, or no known capacity — is
 * Infinity rather than zero: it is accounted but never blocked, because
 * rejecting the first turns of a workspace cp has simply not observed yet would
 * be worse than admitting them.
 */
function capacityOf(workspaceId: string): number {
  const ready = readyReplicaCount(workspaceId)
  const perReplica = perReplicaCapacity(workspaceId)
  if (ready === 0 || perReplica === undefined) return Number.POSITIVE_INFINITY
  return ready * perReplica
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
 * Re-run admission for every workspace with turns waiting. A slot freeing is not
 * the only way spare capacity appears — an auto-scaling workspace's cap also
 * grows when a new replica becomes ready, and nothing releases a slot at that
 * moment, so without this the turns that scale-up was meant to serve would wait
 * for an unrelated turn to finish. Called after the replica-router refresh.
 */
export function drainAll(): void {
  for (const workspaceId of [...waiters.keys()]) drain(workspaceId)
}

/**
 * Admit one turn against a workspace, resolving to a slot the caller releases
 * when the turn ends. Under capacity it resolves immediately. Over capacity it
 * WAITS for a slot — the same "wait for your turn" behaviour the scheduler
 * already uses for per-workspace concurrency — resolving as soon as one frees or
 * the cap grows.
 *
 * Rejects with {@link TurnCapacityError} when the queue is already full, or when
 * this turn has waited past the limit. Both mean the same thing to the caller:
 * the workspace is saturated, try again.
 */
export function acquireTurn(workspaceId: string): Promise<TurnSlot> {
  const active = activeTurns.get(workspaceId) ?? 0
  if (active < capacityOf(workspaceId)) {
    activeTurns.set(workspaceId, active + 1)
    return Promise.resolve(makeSlot(workspaceId))
  }

  // Over capacity: queue behind a bound. The slot is handed over by drain(),
  // which has already incremented the active count on this workspace's behalf.
  const q = waiters.get(workspaceId) ?? []
  if (q.length >= MAX_QUEUE_PER_WS) return Promise.reject(new TurnCapacityError(workspaceId))
  return new Promise<TurnSlot>((resolve, reject) => {
    const waiter: Waiter = {
      grant: () => resolve(makeSlot(workspaceId)),
      reject,
      timer: setTimeout(() => {
        const queue = waiters.get(workspaceId)
        const at = queue?.indexOf(waiter) ?? -1
        if (at >= 0) queue?.splice(at, 1)
        if (queue?.length === 0) waiters.delete(workspaceId)
        reject(new TurnCapacityError(workspaceId))
      }, MAX_WAIT_MS),
    }
    q.push(waiter)
    waiters.set(workspaceId, q)
  })
}

/**
 * A workspace's current turn demand: turns in flight plus turns waiting for a
 * slot. This is the one signal the autoscaler scales on — no separate metric.
 */
export function turnDemand(workspaceId: string): { active: number; queued: number } {
  return {
    active: activeTurns.get(workspaceId) ?? 0,
    queued: waiters.get(workspaceId)?.length ?? 0,
  }
}

/** Test seam: drop all admission state, rejecting any still-pending waiters. */
export function __resetTurnGate(): void {
  for (const q of waiters.values()) {
    for (const w of q) {
      clearTimeout(w.timer)
      w.reject(new TurnCapacityError('__reset__'))
    }
  }
  waiters.clear()
  activeTurns.clear()
}
