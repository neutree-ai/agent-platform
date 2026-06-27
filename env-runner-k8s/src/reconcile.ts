import type { EnvironmentProvider, WorkspaceSpec } from '../../internal/types/environments'
import { type PlacementRow, deletePlacement, listKubernetesPlacements, writeObserved } from './db'

// Provider-agnostic reconcile core. It depends only on EnvironmentProvider, so
// when a second runner (env-runner-docker, …) appears this file moves verbatim
// into internal/env-runner-core and each runner wires its own provider.
//
// Reconcile drives actual → desired for each placement. Two independent triggers
// (design §13.1):
//   1. spec drift     — spec_version > observed_version → apply(spec)
//   2. lifecycle drift — desired_phase ≠ observed phase → start / stop / destroy
// With desired == observed and spec_version == observed_version (the backfill /
// cutover invariant), a pass is a no-op. The runner only acts on what cp writes.

type ReconcileAction = 'apply' | 'start' | 'stop' | 'destroy' | 'none'

async function reconcilePlacement(
  provider: EnvironmentProvider,
  p: PlacementRow,
): Promise<ReconcileAction> {
  // desired=deleted: tear down and drop the row (terminal).
  if (p.desired_phase === 'deleted') {
    await provider.destroy(p.workspace_id)
    await deletePlacement(p.workspace_id)
    return 'destroy'
  }

  const current = await provider.observe(p.workspace_id)
  const exists = current.phase !== 'unknown'

  // spec drift: cp bumped the spec — (re)apply, then record convergence.
  if (p.spec_version > (p.observed_version ?? 0)) {
    await provider.apply(p.workspace_id, p.spec as WorkspaceSpec)
    const after = await provider.observe(p.workspace_id)
    await writeObserved(p.workspace_id, {
      phase: after.phase,
      endpoint: after.endpoint,
      version: p.spec_version,
    })
    return 'apply'
  }

  // lifecycle drift.
  if (p.desired_phase === 'running' && current.phase !== 'running') {
    // No object yet → create from spec; otherwise just scale back up.
    if (!exists) {
      await provider.apply(p.workspace_id, p.spec as WorkspaceSpec)
    } else if (current.phase === 'stopped') {
      await provider.start(p.workspace_id)
    } else {
      // starting/error/pending — in-flight, leave it; just record below.
      await writeObserved(p.workspace_id, { phase: current.phase, endpoint: current.endpoint })
      return 'none'
    }
    const after = await provider.observe(p.workspace_id)
    await writeObserved(p.workspace_id, {
      phase: after.phase,
      endpoint: after.endpoint,
      version: exists ? undefined : p.spec_version,
    })
    return exists ? 'start' : 'apply'
  }

  if (p.desired_phase === 'stopped' && current.phase !== 'stopped') {
    await provider.stop(p.workspace_id)
    const after = await provider.observe(p.workspace_id)
    await writeObserved(p.workspace_id, { phase: after.phase, endpoint: after.endpoint })
    return 'stop'
  }

  // Converged — just record what we see.
  await writeObserved(p.workspace_id, { phase: current.phase, endpoint: current.endpoint })
  return 'none'
}

/** One reconcile pass over all kind=kubernetes placements. */
async function reconcileOnce(
  provider: EnvironmentProvider,
): Promise<{ acted: number; noop: number; failed: number }> {
  const placements = await listKubernetesPlacements()
  let acted = 0
  let noop = 0
  let failed = 0
  for (const p of placements) {
    try {
      const action = await reconcilePlacement(provider, p)
      if (action === 'none') noop++
      else acted++
    } catch (err) {
      failed++
      console.error(`[env-runner-k8s] reconcile failed for ${p.workspace_id}:`, err)
    }
  }
  return { acted, noop, failed }
}

/** Run {@link reconcileOnce} on an interval until the returned stop() is called. */
export function startReconcileLoop(provider: EnvironmentProvider, intervalMs: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      const { acted, noop, failed } = await reconcileOnce(provider)
      console.log(`[env-runner-k8s] reconcile pass: ${acted} acted, ${noop} noop, ${failed} failed`)
    } catch (err) {
      console.error('[env-runner-k8s] reconcile pass failed:', err)
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
