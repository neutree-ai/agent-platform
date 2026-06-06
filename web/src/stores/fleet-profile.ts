import { api } from '@/lib/api/client'
import type { UserProfilePayload } from '@/lib/api/types'
import { type ProfileBackend, registerProfileBackend } from '@/stores/workspace-profile-store'

/**
 * Fleet (global) shell reuses the workspace-profile store under a synthetic
 * id, so SlotProvider and per-instance state hooks work identically across
 * fleet and ws scopes. The fleet backend is server-backed via the
 * `user_profile` resource — same opaque-payload semantics as the
 * workspace profile, scoped to the current user.
 */
export const FLEET_PROFILE_ID = '__fleet__'

// Legacy LS key from the pre-DB era. Read once on first load to seed the
// server, then the key is dropped. Safe to keep around indefinitely;
// users who never had it just see an empty server response.
const LEGACY_LS_KEY = 'tos.fleet-profile.v1'
const MIGRATION_FLAG_KEY = 'tos.fleet-profile.migrated.v1'

function readLegacyLs(): UserProfilePayload | null {
  if (sessionStorage.getItem(MIGRATION_FLAG_KEY)) return null
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    return raw ? (JSON.parse(raw) as UserProfilePayload) : null
  } catch {
    return null
  }
}

function clearLegacyLs(): void {
  try {
    localStorage.removeItem(LEGACY_LS_KEY)
    sessionStorage.setItem(MIGRATION_FLAG_KEY, '1')
  } catch {
    // Ignore — flag is best-effort.
  }
}

const fleetBackend: ProfileBackend = {
  load: async () => {
    const remote = await api.getUserProfile()
    // One-shot migration: if server is empty and there's pre-existing LS
    // payload, push it server-side and forget the LS key. Subsequent loads
    // see the server as source of truth.
    const isEmpty = !remote || Object.keys(remote).length === 0
    if (isEmpty) {
      const legacy = readLegacyLs()
      if (legacy && Object.keys(legacy).length > 0) {
        try {
          const merged = await api.patchUserProfile(legacy)
          clearLegacyLs()
          return merged
        } catch {
          // Server unreachable — keep LS in place so we can retry next load.
          return legacy
        }
      }
      clearLegacyLs() // nothing to migrate; flag so we don't re-check.
    }
    return remote
  },
  save: async (_id, patch) => api.patchUserProfile(patch),
}

registerProfileBackend(FLEET_PROFILE_ID, fleetBackend)
