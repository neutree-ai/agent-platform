import { api } from '@/lib/api/client'
import type { WorkspaceProfilePayload } from '@/lib/api/types'
import { create } from 'zustand'

/**
 * Per-workspace UI profile store.
 *
 * The payload is opaque to the server — shape is defined here. Reads bootstrap
 * from `GET /workspaces/:id/profile`; writes go to `PATCH ...` (server does
 * shallow merge so concurrent tabs / older clients don't clobber each other).
 *
 * Top-level keys defined here so far:
 *   layout_id  ?: string                          // active layout for this ws
 *   slots      ?: Record<string, { opened?, active? }>
 *
 * Treat every field as optional; missing → caller-side default. New keys may
 * be added without migration.
 */

interface State {
  byWorkspace: Record<string, WorkspaceProfilePayload>
}

interface Actions {
  ensureLoaded(workspaceId: string): void
  patch(workspaceId: string, patch: WorkspaceProfilePayload): void
}

/**
 * Backing strategy for a profile id. Lets the store stay agnostic about
 * where each profile lives — the default backend hits the server; callers
 * (e.g., the fleet shell) can register an LS-only backend for synthetic
 * ids that don't have a server resource. Register before mounting any
 * SlotProvider that uses the id; unregister never (single-process lifetime).
 */
export interface ProfileBackend {
  load: (id: string) => Promise<WorkspaceProfilePayload>
  save: (id: string, patch: WorkspaceProfilePayload) => Promise<WorkspaceProfilePayload>
}

const apiBackend: ProfileBackend = {
  load: (id) => api.getWorkspaceProfile(id),
  save: (id, patch) => api.patchWorkspaceProfile(id, patch),
}

const backendOverrides = new Map<string, ProfileBackend>()

export function registerProfileBackend(id: string, backend: ProfileBackend): void {
  backendOverrides.set(id, backend)
}

function backendFor(id: string): ProfileBackend {
  return backendOverrides.get(id) ?? apiBackend
}

const loadStarted = new Set<string>()
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, WorkspaceProfilePayload>()
const FLUSH_DEBOUNCE_MS = 400

export const useWorkspaceProfileStore = create<State & Actions>()((set) => ({
  byWorkspace: {},

  ensureLoaded(workspaceId) {
    if (loadStarted.has(workspaceId)) return
    loadStarted.add(workspaceId)
    backendFor(workspaceId)
      .load(workspaceId)
      .then((payload) => {
        set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: payload } }))
      })
      .catch((err) => {
        loadStarted.delete(workspaceId) // allow retry
        console.error('[workspace-profile] load failed', workspaceId, err)
      })
  },

  patch(workspaceId, patch) {
    set((s) => ({
      byWorkspace: {
        ...s.byWorkspace,
        [workspaceId]: { ...(s.byWorkspace[workspaceId] ?? {}), ...patch },
      },
    }))

    pending.set(workspaceId, { ...(pending.get(workspaceId) ?? {}), ...patch })

    const existing = flushTimers.get(workspaceId)
    if (existing) clearTimeout(existing)
    flushTimers.set(
      workspaceId,
      setTimeout(() => void flush(workspaceId), FLUSH_DEBOUNCE_MS),
    )
  },
}))

async function flush(workspaceId: string) {
  flushTimers.delete(workspaceId)
  const patch = pending.get(workspaceId)
  if (!patch) return
  pending.delete(workspaceId)
  try {
    const merged = await backendFor(workspaceId).save(workspaceId, patch)
    useWorkspaceProfileStore.setState((s) => ({
      byWorkspace: { ...s.byWorkspace, [workspaceId]: merged },
    }))
  } catch (err) {
    console.error('[workspace-profile] flush failed', workspaceId, err)
    pending.set(workspaceId, { ...patch, ...(pending.get(workspaceId) ?? {}) })
  }
}

const EMPTY: WorkspaceProfilePayload = {}

export function useWorkspaceProfile(workspaceId: string | undefined): WorkspaceProfilePayload {
  return useWorkspaceProfileStore((s) =>
    workspaceId ? (s.byWorkspace[workspaceId] ?? EMPTY) : EMPTY,
  )
}

/** True once the initial GET has resolved (even if payload is empty). */
export function useWorkspaceProfileLoaded(workspaceId: string | undefined): boolean {
  return useWorkspaceProfileStore((s) => (workspaceId ? workspaceId in s.byWorkspace : true))
}
