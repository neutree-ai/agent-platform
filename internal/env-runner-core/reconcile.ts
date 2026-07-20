import type { EnvironmentProvider, ObservedState, WorkspaceSpec } from '../types/environments'
import type { PlacementRow, PlacementTransport } from './transport'

// Provider- and transport-agnostic reconcile core. It depends only on
// EnvironmentProvider (how to act on infra) and PlacementTransport (how to read
// desired / write observed), so the same code serves the in-cluster direct-DB
// runner and a remote runner talking the /env/v1 protocol. Extracted from
// env-runner-k8s in P2-B; each runner wires its own provider + transport.
//
// Reconcile drives actual → desired for each placement. Two independent triggers
// (design §13.1):
//   1. spec drift     — spec_version > observed_version → apply(spec)
//   2. lifecycle drift — desired_phase ≠ observed phase → start / stop / destroy
// With desired == observed and spec_version == observed_version (the backfill /
// cutover invariant), a pass is a no-op. The runner only acts on what cp writes.

type ReconcileAction = 'apply' | 'start' | 'stop' | 'destroy' | 'none'

/**
 * Write observed state back only when it carries information a steady-state
 * pass over N converged placements would otherwise issue N no-op DB writes.
 * Two cases warrant a write:
 *   - phase moved; or
 *   - a RUNNING auto-scaling workspace's ready-replica set may have shifted
 *     (a pod dies/recovers, scale-up readiness fills in) while phase stays
 *     'running', so a phase-only gate would let cp's routing signal go stale.
 *     This is data-driven, not a runtime-mode branch — a static workspace never
 *     reports readyReplicaIds. Gated on 'running' so a stopped/idle set (empty,
 *     byte-identical every pass) collapses back to the phase-gated path.
 */
async function recordIfChanged(
  transport: PlacementTransport,
  p: PlacementRow,
  current: ObservedState,
): Promise<void> {
  const readySetMayHaveShifted =
    current.phase === 'running' && current.endpoint?.readyReplicaIds !== undefined
  if (current.phase !== p.observed_phase || readySetMayHaveShifted) {
    await transport.writeObserved(p.workspace_id, {
      phase: current.phase,
      endpoint: current.endpoint,
    })
  }
}

async function reconcilePlacement(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
  p: PlacementRow,
  // Pre-fetched observation for this workspace (from the per-pass batch observe,
  // or a per-id observe() when the provider has no batch). Avoids an observe()
  // round-trip per placement.
  current: ObservedState,
): Promise<ReconcileAction> {
  // desired=deleted: tear down and drop the row (terminal).
  if (p.desired_phase === 'deleted') {
    await provider.destroy(p.workspace_id)
    await transport.deletePlacement(p.workspace_id)
    return 'destroy'
  }

  const exists = current.phase !== 'unknown'

  // desired=stopped: ensure scaled down. Spec drift is intentionally NOT applied
  // while stopped — a config change to a stopped ws stays dormant until its next
  // start (when desired flips to running), avoiding waking a ws the user stopped.
  if (p.desired_phase === 'stopped') {
    if (current.phase !== 'stopped' && exists) {
      await provider.stop(p.workspace_id)
      const after = await provider.observe(p.workspace_id)
      await transport.writeObserved(p.workspace_id, {
        phase: after.phase,
        endpoint: after.endpoint,
      })
      return 'stop'
    }
    await recordIfChanged(transport, p, current)
    return 'none'
  }

  // desired=running below.

  // spec drift: cp bumped the spec — (re)apply, then record convergence.
  if (p.spec_version > (p.observed_version ?? 0)) {
    await provider.apply(p.workspace_id, p.spec as WorkspaceSpec)
    const after = await provider.observe(p.workspace_id)
    await transport.writeObserved(p.workspace_id, {
      phase: after.phase,
      endpoint: after.endpoint,
      version: p.spec_version,
    })
    return 'apply'
  }

  // lifecycle drift: should be running but isn't.
  if (current.phase !== 'running') {
    if (!exists) {
      // No object yet → create from spec (records convergence).
      await provider.apply(p.workspace_id, p.spec as WorkspaceSpec)
      const after = await provider.observe(p.workspace_id)
      await transport.writeObserved(p.workspace_id, {
        phase: after.phase,
        endpoint: after.endpoint,
        version: p.spec_version,
      })
      return 'apply'
    }
    if (current.phase === 'stopped') {
      await provider.start(p.workspace_id)
      const after = await provider.observe(p.workspace_id)
      await transport.writeObserved(p.workspace_id, {
        phase: after.phase,
        endpoint: after.endpoint,
      })
      return 'start'
    }
    // starting/error/pending — in-flight, just record.
    await recordIfChanged(transport, p, current)
    return 'none'
  }

  // Converged — just record what we see.
  await recordIfChanged(transport, p, current)
  return 'none'
}

/**
 * One reconcile pass over every placement this runner is responsible for.
 * Exported for standalone use / testing: callers that want a single pass
 * (rather than the interval loop of {@link startReconcileLoop}) can invoke it
 * directly and inspect the returned action counts.
 */
export async function reconcileOnce(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
): Promise<{ acted: number; noop: number; failed: number }> {
  const placements = await transport.listPlacements()
  // Observe everything in one round-trip when the provider supports it (k8s: a
  // single LIST), so a pass is O(1) infra calls instead of O(N) observe()s.
  // Providers without observeAll fall back to a per-placement observe().
  const observedAll = provider.observeAll ? await provider.observeAll() : null
  let acted = 0
  let noop = 0
  let failed = 0
  for (const p of placements) {
    try {
      const current = observedAll
        ? (observedAll.get(p.workspace_id) ?? { phase: 'unknown' as const })
        : await provider.observe(p.workspace_id)
      const action = await reconcilePlacement(provider, transport, p, current)
      if (action === 'none') noop++
      else acted++
    } catch (err) {
      failed++
      console.error(`[env-runner] reconcile failed for ${p.workspace_id}:`, err)
    }
  }
  // Heartbeat once per pass: liveness + current capabilities. The db transport
  // makes this a no-op (built-in liveness is cp's own concern); the http
  // transport reports it to cp so a remote environment is marked online.
  try {
    await transport.heartbeat(provider.capabilities() as unknown as Record<string, unknown>)
  } catch (err) {
    console.error('[env-runner] heartbeat failed:', err)
  }
  return { acted, noop, failed }
}

/** Run {@link reconcileOnce} on an interval until the returned stop() is called. */
export function startReconcileLoop(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
  intervalMs: number,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      const { acted, noop, failed } = await reconcileOnce(provider, transport)
      console.log(`[env-runner] reconcile pass: ${acted} acted, ${noop} noop, ${failed} failed`)
    } catch (err) {
      console.error('[env-runner] reconcile pass failed:', err)
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
