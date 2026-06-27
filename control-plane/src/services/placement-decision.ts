import { type EnvironmentWithAccess, getEnvironmentForUser } from './db/environments'

// Placement decision (design §8): choose the environment a new workspace runs
// on, from the set the user can see, and negotiate capabilities. The built-in
// environment is the platform's own cluster — always reachable and fully
// capable; remote environments must be online and advertise the required
// features via their runner heartbeat (environments.capabilities).

const BUILTIN_ENV = 'builtin'

interface RequiredFeatures {
  sharedFs?: boolean
  persistentMemory?: boolean
}

type PlacementDecision =
  | {
      ok: true
      environmentId: string
      /** What the chosen environment can actually provide (drives opportunistic features). */
      supports: { sharedFs: boolean; persistentMemory: boolean }
    }
  | { ok: false; error: string }

function envSupports(
  env: EnvironmentWithAccess,
  feature: 'sharedFs' | 'persistentMemory',
): boolean {
  // The built-in cluster ships afs-fuse + memory-fuse, so it supports everything;
  // its capabilities row is empty by design. Remote environments must advertise.
  if (env.is_builtin) return true
  return env.capabilities?.[feature] === true
}

export async function chooseEnvironment(opts: {
  userId: string
  isSystem: boolean
  requestedEnvironmentId?: string
  required: RequiredFeatures
}): Promise<PlacementDecision> {
  // System workspaces always run on the built-in environment.
  if (opts.isSystem) {
    return {
      ok: true,
      environmentId: BUILTIN_ENV,
      supports: { sharedFs: true, persistentMemory: true },
    }
  }

  const targetId = opts.requestedEnvironmentId || BUILTIN_ENV
  const env = await getEnvironmentForUser(targetId, opts.userId)
  if (!env) {
    return { ok: false, error: `Environment '${targetId}' not found or not accessible` }
  }

  // Remote environments must be online to place onto; built-in is always up.
  if (!env.is_builtin && env.status !== 'online') {
    return {
      ok: false,
      error: `Environment '${env.name}' is ${env.status}, cannot place workspaces`,
    }
  }

  // Capability negotiation: every explicitly required feature must be supported.
  const supports = {
    sharedFs: envSupports(env, 'sharedFs'),
    persistentMemory: envSupports(env, 'persistentMemory'),
  }
  if (opts.required.persistentMemory && !supports.persistentMemory) {
    return { ok: false, error: `Environment '${env.name}' does not support persistent memory` }
  }
  if (opts.required.sharedFs && !supports.sharedFs) {
    return { ok: false, error: `Environment '${env.name}' does not support a shared filesystem` }
  }

  return { ok: true, environmentId: env.id, supports }
}
