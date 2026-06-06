import { useSlotContext } from '@/contexts/SlotContext'
import { useWorkspaceProfile, useWorkspaceProfileStore } from '@/stores/workspace-profile-store'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useParams } from 'react-router-dom'
import { create } from 'zustand'

/**
 * Headless per-instance state store.
 *
 * Apps that own UI state (scroll, tree expand, search, draft form, cwd)
 * should keep it keyed by their instance id, instead of `useState` inside
 * the component. Layout switches / fill toggles / brief unmounts then
 * preserve the user's view.
 *
 * Two flavours, mirror each other in API:
 *   useInstanceState           — in-memory; survives unmount, lost on refresh
 *   useInstancePersistentState — same API, written to workspace_profile
 *                                (DB-backed via the workspace-profile store);
 *                                survives refresh and is cross-device
 *
 * Pick per field:
 *  - cwd / drive / sort → persistent (refresh shouldn't reset to root)
 *  - search query / fetched listings → in-memory (cheap to recompute)
 *  - dialog open / drag counter → still useState (transient render-cigh
 *
 * Both stores are namespaced by **workspace** as well as instance — slot
 * default instance ids (e.g. `slot-a:settings`) are deterministic and
 * therefore identical across workspaces; without the workspace dimension,
 * a draft written by ws A's Settings would leak into ws B's Settings on
 * switch. The workspace id is read from SlotContext (preferred) or falls
 * back to the URL `:workspaceId` param.
 *
 * When a slot closes an instance, both layers are dropped automatically
 * (SlotContext.close releases the in-memory bag and removes the persistent
 * entry from the profile).
 */

type Bag = Record<string, unknown>
type WorkspaceBags = Record<string, Bag>

interface State {
  byWorkspace: Record<string, WorkspaceBags>
}

interface Actions {
  set(workspaceId: string, instanceId: string, key: string, value: unknown): void
  dropInstance(workspaceId: string, instanceId: string): void
}

const useStore = create<State & Actions>()((set) => ({
  byWorkspace: {},
  set(workspaceId, instanceId, key, value) {
    set((s) => {
      const wsBags = s.byWorkspace[workspaceId] ?? {}
      const cur = wsBags[instanceId] ?? {}
      if (Object.is(cur[key], value)) return s
      return {
        byWorkspace: {
          ...s.byWorkspace,
          [workspaceId]: { ...wsBags, [instanceId]: { ...cur, [key]: value } },
        },
      }
    })
  },
  dropInstance(workspaceId, instanceId) {
    set((s) => {
      const wsBags = s.byWorkspace[workspaceId]
      if (!wsBags || !(instanceId in wsBags)) return s
      const nextWs = { ...wsBags }
      delete nextWs[instanceId]
      return { byWorkspace: { ...s.byWorkspace, [workspaceId]: nextWs } }
    })
  },
}))

/**
 * Drop a single instance's in-memory bag in the given workspace. Called by
 * SlotContext.close — closing an instance shouldn't leave its draft state
 * dangling for re-open.
 */
export function dropInstanceState(workspaceId: string, instanceId: string): void {
  useStore.getState().dropInstance(workspaceId, instanceId)
}

/**
 * Like `useState`, but the value lives in the per-instance store under
 * `(workspaceId, instanceId, key)`. The default factory runs at most once
 * per (workspace, instance, key) tuple; later mounts re-read whatever was
 * last written.
 *
 * Workspace id resolution mirrors `useInstancePersistentState`: SlotContext
 * first (works in fleet scope where the URL has no `:workspaceId`), URL
 * params as fallback.
 */
export function useInstanceState<T>(
  instanceId: string,
  key: string,
  defaultFn: () => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const slotCtx = useSlotContext()
  const { workspaceId: paramWs } = useParams<{ workspaceId?: string }>()
  const workspaceId = slotCtx?.workspaceId ?? paramWs ?? ''

  // Subscribe directly via useSyncExternalStore so we re-render on any
  // change to *this* (workspace, instance, key) tuple and nothing else.
  const value = useSyncExternalStore(
    (cb) => useStore.subscribe(cb),
    () => {
      const v = useStore.getState().byWorkspace[workspaceId]?.[instanceId]?.[key]
      if (v === undefined) {
        const seed = defaultFn()
        useStore.getState().set(workspaceId, instanceId, key, seed)
        return seed as unknown
      }
      return v
    },
  ) as T

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const cur = useStore.getState().byWorkspace[workspaceId]?.[instanceId]?.[key]
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)((cur === undefined ? defaultFn() : cur) as T)
          : next
      useStore.getState().set(workspaceId, instanceId, key, resolved)
    },
    // defaultFn intentionally not in deps — only consulted on first read.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
    [workspaceId, instanceId, key],
  )

  return [value, setValue]
}

/* ── persistent variant ──────────────────────────────────────────────── */

type InstancesMap = Record<string, Record<string, unknown>>

function readPersistent(
  payload: { instances?: InstancesMap },
  instanceId: string,
  key: string,
): unknown {
  return payload.instances?.[instanceId]?.[key]
}

/**
 * Like `useInstanceState` but the value is written to the workspace profile
 * (debounced PATCH to cp). Use for state that should survive a page reload
 * — cwd, drive, sort, view mode. Don't use for high-frequency state
 * (per-keystroke search input) — debounce is 400ms but each keystroke
 * still re-renders subscribers.
 */
export function useInstancePersistentState<T>(
  instanceId: string,
  key: string,
  defaultFn: () => T,
): [T, (next: T | ((prev: T) => T)) => void] {
  // Prefer the SlotContext profile id (works in fleet scope where the URL
  // has no :workspaceId segment); fall back to URL params for callers
  // mounted outside a SlotProvider.
  const slotCtx = useSlotContext()
  const { workspaceId: paramWs } = useParams<{ workspaceId?: string }>()
  const workspaceId = slotCtx?.workspaceId ?? paramWs
  const payload = useWorkspaceProfile(workspaceId)

  const value: T = useMemo(() => {
    const stored = readPersistent(payload, instanceId, key)
    return stored === undefined ? defaultFn() : (stored as T)
    // defaultFn intentionally excluded — only used when stored is missing.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  }, [payload, instanceId, key])

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (!workspaceId) return
      const store = useWorkspaceProfileStore.getState()
      const wsPayload = store.byWorkspace[workspaceId] as { instances?: InstancesMap } | undefined
      const curInstances = wsPayload?.instances ?? {}
      const curEntry = curInstances[instanceId] ?? {}
      const curVal = curEntry[key]
      const prev = curVal === undefined ? defaultFn() : (curVal as T)
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      if (Object.is(curVal, resolved)) return
      const nextInstances: InstancesMap = {
        ...curInstances,
        [instanceId]: { ...curEntry, [key]: resolved },
      }
      store.patch(workspaceId, { instances: nextInstances })
    },
    // defaultFn intentionally excluded.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
    [workspaceId, instanceId, key],
  )

  return [value, setValue]
}

/**
 * Imperatively write a persistent instance value from outside React.
 * Mirror of `setInstanceState` for the persistent layer.
 */
export function setPersistentInstanceState(
  workspaceId: string,
  instanceId: string,
  key: string,
  value: unknown,
): void {
  const store = useWorkspaceProfileStore.getState()
  const wsPayload = store.byWorkspace[workspaceId] as { instances?: InstancesMap } | undefined
  const curInstances = wsPayload?.instances ?? {}
  const curEntry = curInstances[instanceId] ?? {}
  if (Object.is(curEntry[key], value)) return
  store.patch(workspaceId, {
    instances: { ...curInstances, [instanceId]: { ...curEntry, [key]: value } },
  })
}

/**
 * Batch variant — one store.patch for several keys on the same instance.
 * Use when seeding multiple persistent fields together (e.g. a viewer's
 * path + scroll anchor) to avoid notifying subscribers per-key.
 */
export function setPersistentInstanceStateMany(
  workspaceId: string,
  instanceId: string,
  patch: Record<string, unknown>,
): void {
  const store = useWorkspaceProfileStore.getState()
  const wsPayload = store.byWorkspace[workspaceId] as { instances?: InstancesMap } | undefined
  const curInstances = wsPayload?.instances ?? {}
  const curEntry = curInstances[instanceId] ?? {}
  let changed = false
  const nextEntry: Record<string, unknown> = { ...curEntry }
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.is(curEntry[k], v)) {
      nextEntry[k] = v
      changed = true
    }
  }
  if (!changed) return
  store.patch(workspaceId, {
    instances: { ...curInstances, [instanceId]: nextEntry },
  })
}

/**
 * Remove all persistent state for an instance from the workspace profile.
 * Called by SlotContext.close so closed instances don't accumulate in DB.
 */
export function dropPersistentInstanceState(workspaceId: string, instanceId: string): void {
  const store = useWorkspaceProfileStore.getState()
  const wsPayload = store.byWorkspace[workspaceId] as { instances?: InstancesMap } | undefined
  const curInstances = wsPayload?.instances
  if (!curInstances || !(instanceId in curInstances)) return
  const next = { ...curInstances }
  delete next[instanceId]
  // Shallow merge can't delete keys, so write the full instances object.
  store.patch(workspaceId, { instances: next })
}
