import { defaultCfg } from '../../../internal/k8s-provider'
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
  /** Auto-scaling: multiple replicas on one RWX volume (design §7). */
  multiReplica?: boolean
}

interface Supports {
  sharedFs: boolean
  persistentMemory: boolean
  multiReplica: boolean
}

type PlacementDecision =
  | {
      ok: true
      environmentId: string
      /** What the chosen environment can actually provide (drives opportunistic features). */
      supports: Supports
    }
  | { ok: false; error: string }

function envSupports(env: EnvironmentWithAccess, feature: keyof Supports): boolean {
  if (env.is_builtin) {
    // The built-in cluster ships afs-fuse + memory-fuse unconditionally. But
    // multiReplica is deploy-gated (it needs a ReadWriteMany storage class), so
    // read it from cp's own provider config rather than assuming true.
    if (feature === 'multiReplica') return defaultCfg.multiReplica
    return true
  }
  // Remote environments advertise every capability, multiReplica included.
  return env.capabilities?.[feature] === true
}

function supportsFor(env: EnvironmentWithAccess): Supports {
  return {
    sharedFs: envSupports(env, 'sharedFs'),
    persistentMemory: envSupports(env, 'persistentMemory'),
    multiReplica: envSupports(env, 'multiReplica'),
  }
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
      supports: { sharedFs: true, persistentMemory: true, multiReplica: defaultCfg.multiReplica },
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
  const supports = supportsFor(env)
  if (opts.required.persistentMemory && !supports.persistentMemory) {
    return { ok: false, error: `Environment '${env.name}' does not support persistent memory` }
  }
  if (opts.required.sharedFs && !supports.sharedFs) {
    return { ok: false, error: `Environment '${env.name}' does not support a shared filesystem` }
  }
  if (opts.required.multiReplica && !supports.multiReplica) {
    return {
      ok: false,
      error: `Environment '${env.name}' does not support auto-scaling workspaces`,
    }
  }

  return { ok: true, environmentId: env.id, supports }
}
