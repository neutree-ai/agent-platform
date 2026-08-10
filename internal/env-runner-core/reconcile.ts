import type { Closable, EnvironmentProvider, ObservedState } from '../types/environments'
import { toWorkspaceSpec } from './spec'
import type { ObservedUpdate, PlacementRow, PlacementTransport } from './transport'

// Provider- and transport-agnostic reconcile core. It depends only on
// EnvironmentProvider (how to act on infra) and PlacementTransport (how to read
// desired / write observed), so the same code serves the in-cluster direct-DB
// runner and a remote runner talking the /env/v1 protocol; each wires its own
// provider + transport.
//
// Reconcile drives actual → desired for each placement, on two independent
// triggers:
//   1. spec drift      — spec_version > observed_version → apply(spec)
//   2. lifecycle drift — desired_phase ≠ observed phase → start / stop / destroy
// With desired == observed and spec_version == observed_version, a pass is a
// no-op. The runner only acts on what cp writes.

type ReconcileAction = 'apply' | 'start' | 'stop' | 'destroy' | 'none'

/**
 * The write-back form of an observation. `version` is passed only after an
 * apply, where it records convergence to a spec version; every other path
 * leaves it out so the stored value survives.
 */
function observedUpdate(s: ObservedState, version?: number): ObservedUpdate {
  return {
    phase: s.phase,
    endpoint: s.endpoint,
    // Explicit null, not omitted: a phase that recovered has to clear the
    // message the failing phase left behind.
    message: s.message ?? null,
    templateVersion: s.templateVersion ?? null,
    ...(version !== undefined ? { version } : {}),
  }
}

/** The ready-replica set carried by a stored or freshly observed endpoint. */
function readyIds(endpoint: unknown): string {
  const ids = (endpoint as { readyReplicaIds?: unknown } | null | undefined)?.readyReplicaIds
  return Array.isArray(ids) ? ids.join(',') : ''
}

/**
 * Everything about an observation that cp consumes, as one comparable value: the
 * phase, the ready-replica set that drives routing / turn capacity / reload
 * fan-out, and the template version behind "rebuild available".
 *
 * Both observers — the periodic pass and the change stream — decide whether to
 * write by comparing this, so the two cannot drift into disagreeing about what
 * counts as new. A signature is also what makes a steady-state pass free: every
 * workspace reports a ready set, so "it has one" says nothing, and only an
 * actual change may cost a write.
 */
function signature(
  phase: string | null,
  endpoint: unknown,
  templateVersion: number | null | undefined,
): string {
  return `${phase}|${readyIds(endpoint)}|${templateVersion ?? ''}`
}

const storedSignature = (p: PlacementRow): string =>
  signature(p.observed_phase, p.endpoint, p.observed_template_version)

const observedSignature = (s: ObservedState): string =>
  signature(s.phase, s.endpoint, s.templateVersion)

/** Write observed state back only when it says something new. */
async function recordIfChanged(
  transport: PlacementTransport,
  p: PlacementRow,
  current: ObservedState,
): Promise<void> {
  if (observedSignature(current) !== storedSignature(p)) {
    await transport.writeObserved(p.workspace_id, observedUpdate(current))
  }
}

/**
 * Bridge the provider's change stream onto observed writes, so a workspace's
 * state reaches cp as soon as the infra moves rather than on the next pass.
 *
 * Deliberately does not write `version`: convergence to a spec version is
 * something an apply establishes, and a watch event says nothing about it.
 *
 * Events restate the world rather than describing a delta, so the same
 * observation arrives repeatedly (a rolling update alone produces a burst per
 * workspace). Writing only when the signature changed keeps that from becoming
 * write amplification across a whole environment. A failed write drops the
 * remembered signature so the next event retries.
 *
 * Returns undefined for a provider with no change stream; the periodic pass is
 * then the only observer.
 */
export function startObservedWatch(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
): Closable | undefined {
  if (!provider.watch) return undefined
  return provider.watch((workspaceId, state) => {
    const current = observedSignature(state)
    if (lastWatched.get(workspaceId) === current) return
    lastWatched.set(workspaceId, current)
    transport.writeObserved(workspaceId, observedUpdate(state)).catch((err) => {
      lastWatched.delete(workspaceId)
      console.error(`[env-runner] observed write from watch failed for ${workspaceId}:`, err)
    })
  })
}

/**
 * Last signature the change stream wrote, per workspace. Module-scoped so the
 * reconcile pass can drop an entry when its workspace goes away — otherwise this
 * would grow with every workspace the process has ever seen rather than with the
 * ones that exist.
 */
const lastWatched = new Map<string, string>()

/** Test seam: forget every remembered signature. */
export function __resetObservedWatch(): void {
  lastWatched.clear()
}

/**
 * Mint a workspace token and hand it to the provider, ahead of anything that
 * brings a workload up.
 *
 * Every materialisation gets a fresh one, which is what makes rotation free: a
 * rebuilt or restarted workspace is already carrying a new credential, and cp
 * retires the predecessor once the pod holding it is gone. It also means a
 * workspace that stops and starts does not come back with the token cp revoked
 * on the way down.
 *
 * Skipped when the backend cannot deliver secrets — minting one nothing will
 * receive would just leave rows to sweep.
 */
async function provisionToken(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
  workspaceId: string,
): Promise<void> {
  if (!provider.deliverWorkspaceToken) return
  const token = await transport.mintWorkspaceToken(workspaceId)
  await provider.deliverWorkspaceToken(workspaceId, token)
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
  const spec = toWorkspaceSpec(p.spec)

  // desired=deleted: tear down and drop the row (terminal).
  if (p.desired_phase === 'deleted') {
    await provider.destroy(p.workspace_id)
    await transport.deletePlacement(p.workspace_id)
    lastWatched.delete(p.workspace_id)
    return 'destroy'
  }

  const exists = current.phase !== 'unknown'

  // desired=stopped: ensure scaled down. Spec drift is intentionally NOT applied
  // while stopped — a config change to a stopped ws stays dormant until its next
  // start (when desired flips to running), avoiding waking a ws the user stopped.
  if (p.desired_phase === 'stopped') {
    if (current.phase !== 'stopped' && exists) {
      await provider.stop(p.workspace_id, spec.runtimeMode)
      const after = await provider.observe(p.workspace_id, spec.runtimeMode)
      await transport.writeObserved(p.workspace_id, observedUpdate(after))
      return 'stop'
    }
    await recordIfChanged(transport, p, current)
    return 'none'
  }

  // desired=running below.

  // spec drift: cp bumped the spec — (re)apply, then record convergence.
  if (p.spec_version > (p.observed_version ?? 0)) {
    await provisionToken(provider, transport, p.workspace_id)
    await provider.apply(p.workspace_id, spec)
    const after = await provider.observe(p.workspace_id, spec.runtimeMode)
    await transport.writeObserved(p.workspace_id, observedUpdate(after, p.spec_version))
    return 'apply'
  }

  // lifecycle drift: should be running but isn't.
  if (current.phase !== 'running') {
    if (!exists) {
      // No object yet → create from spec (records convergence).
      await provisionToken(provider, transport, p.workspace_id)
      await provider.apply(p.workspace_id, spec)
      const after = await provider.observe(p.workspace_id, spec.runtimeMode)
      await transport.writeObserved(p.workspace_id, observedUpdate(after, p.spec_version))
      return 'apply'
    }
    if (current.phase === 'stopped') {
      // Not just symmetry with apply: stopping revoked the workspace's tokens,
      // so a start that reused the old one would come back unauthenticated.
      await provisionToken(provider, transport, p.workspace_id)
      await provider.start(p.workspace_id, spec.runtimeMode)
      const after = await provider.observe(p.workspace_id, spec.runtimeMode)
      await transport.writeObserved(p.workspace_id, observedUpdate(after))
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

/**
 * Drive reconcile until the returned stop() is called.
 *
 * Two observers run together. The provider's change stream reports state as the
 * infra moves, which is what makes a workspace's status current within a second
 * of it actually changing. The interval pass is the floor underneath it: it
 * converges desired → actual (the stream only observes, it never acts) and
 * catches anything a stream gap missed.
 */
export function startReconcileLoop(
  provider: EnvironmentProvider,
  transport: PlacementTransport,
  intervalMs: number,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = startObservedWatch(provider, transport)

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
    watcher?.close()
  }
}
