import { type RuntimeMode, assertNever } from '../../../internal/types/runtime-mode'
import { pool } from './db/pool'
import { revokeAllWorkspaceTokens } from './db/workspace-tokens'
import { getWorkspaceConfig } from './db/workspaces'

// Desired-state writes for the placement queue. cp does not call k8s: it records
// *desired* state here and the env-runner (built-in or remote) converges actual →
// desired. The target environment is chosen at create time (placement-decision.ts).

const BUILTIN_ENV = 'builtin'

/** A workspace_config row, narrowed to what the placement spec is built from. */
interface SpecConfig {
  agent_type?: string | null
  compute_resources?: unknown
  auto_scaling?: { min_replicas: number } | null
}

/**
 * Which runtime shape a config row asks for. An auto_scaling block is what makes
 * a workspace auto-scaling; its absence is what makes one static. This is the
 * only place the two are told apart from config — past here the placement spec
 * states the mode outright and everything downstream reads it from there.
 *
 * Declaring the return type keeps callers seeing the full {@link RuntimeMode}
 * union: assigned to a const, a bare literal expression would narrow to just the
 * two branches below and quietly make any `switch` over it exhaustive again.
 */
function runtimeModeOf(config: SpecConfig | null): RuntimeMode {
  return config?.auto_scaling ? 'auto-scaling' : 'static'
}

/**
 * Build the infra-agnostic spec the runner applies, from a workspace_config
 * row (null → platform defaults). Pure — this is the single place where
 * config columns are projected into the placement spec, so growing the spec
 * means adding a field here (and a column migration), not editing callers.
 */
export function buildWorkspaceSpec(
  config: SpecConfig | null,
  version: number,
): {
  agentType: string
  resources: unknown
  version: number
  runtimeMode: RuntimeMode
  replicas?: number
} {
  const base = {
    agentType: config?.agent_type || 'claude-code',
    resources: config?.compute_resources ?? {},
    version,
  }
  const autoScaling = config?.auto_scaling
  const mode = runtimeModeOf(config)
  switch (mode) {
    case 'static':
      // One replica, so no count to carry: the static shape is a single-replica
      // Deployment by construction.
      return { ...base, runtimeMode: mode }
    case 'auto-scaling':
      // max(min_replicas, 1) so a freshly-created workspace is runnable before
      // the autoscaler's first pass and before scale-to-zero can apply. From
      // then on the autoscaler owns the count via setDesiredReplicas, which
      // bumpWorkspaceSpec preserves. The floor also makes the absent case moot:
      // auto_scaling is what selected this arm, so it cannot be missing, and if
      // it somehow were the result would still be the same 1.
      return {
        ...base,
        runtimeMode: mode,
        replicas: Math.max(autoScaling?.min_replicas ?? 0, 1),
      }
    default:
      return assertNever(mode)
  }
}

/**
 * Place a freshly-created workspace on an environment: desired=running, spec from
 * its config, spec_version=1 with observed_version=0 so the runner applies
 * (creates the pod) on its next pass. Records the environment on workspace_config
 * too. Idempotent — a re-create bumps the spec instead.
 */
export async function placeWorkspace(
  workspaceId: string,
  environmentId: string = BUILTIN_ENV,
): Promise<void> {
  const config = await getWorkspaceConfig(workspaceId)
  const spec = buildWorkspaceSpec(config, 1)
  await pool.query(
    `INSERT INTO workspace_placements
       (workspace_id, environment_id, desired_phase, spec, spec_version, observed_version)
     VALUES ($1, $2, 'running', $3, 1, 0)
     ON CONFLICT (workspace_id) DO UPDATE
       SET environment_id = EXCLUDED.environment_id,
           desired_phase = 'running',
           spec_version = workspace_placements.spec_version + 1,
           spec = jsonb_set($3::jsonb, '{version}',
                            to_jsonb(workspace_placements.spec_version + 1))`,
    [workspaceId, environmentId, JSON.stringify(spec)],
  )
  await pool.query('UPDATE workspace_config SET environment_id = $2 WHERE workspace_id = $1', [
    workspaceId,
    environmentId,
  ])
}

/**
 * Set an auto-scaling workspace's desired replica count: update just
 * spec.replicas and bump the spec version so the runner re-applies (scales the
 * StatefulSet). Deliberately targeted — it does NOT rebuild the rest of the spec
 * from config, so it can run every autoscaler tick without clobbering anything
 * else. Only the autoscaler calls this, only for auto-scaling workspaces (whose
 * spec already carries a replicas field).
 */
export async function setDesiredReplicas(workspaceId: string, replicas: number): Promise<void> {
  await pool.query(
    `UPDATE workspace_placements
        SET spec_version = spec_version + 1,
            spec = jsonb_set(
              jsonb_set(spec, '{replicas}', to_jsonb($2::int)),
              '{version}', to_jsonb(spec_version + 1))
      WHERE workspace_id = $1`,
    [workspaceId, replicas],
  )
}

/**
 * Set the desired phase (running | stopped | deleted).
 *
 * Leaving 'running' also revokes the workspace's tokens. A workspace that is
 * not meant to be up has no workload that should still be able to reach cp, and
 * the next start mints a fresh one anyway. This sits here rather than at the
 * three call sites that stop a workspace (manual stop, idle GC, scale-to-zero)
 * because a fourth one will be added eventually and would forget.
 */
export async function setDesiredPhase(
  workspaceId: string,
  phase: 'running' | 'stopped' | 'deleted',
): Promise<void> {
  await pool.query('UPDATE workspace_placements SET desired_phase = $2 WHERE workspace_id = $1', [
    workspaceId,
    phase,
  ])
  if (phase !== 'running') {
    await revokeAllWorkspaceTokens(workspaceId)
  }
}

/**
 * Bump the spec (rebuilt from current config) and spec_version, so the runner
 * re-applies — the inverted equivalent of rebuild / resize / template-drift
 * fixes. Does NOT change desired_phase: a config change to a *stopped* workspace
 * stays dormant (the runner only applies spec drift when desired=running), and
 * is picked up on the next start. spec.version is kept in sync with the
 * spec_version column via jsonb_set.
 */
export async function bumpWorkspaceSpec(workspaceId: string): Promise<void> {
  const config = await getWorkspaceConfig(workspaceId)
  const spec = buildWorkspaceSpec(config, 0)
  // The autoscaler owns replicas via setDesiredReplicas; a config-driven rebuild
  // must not reset that live count back to the creation initial. Only relevant
  // for auto-scaling (spec.replicas present); static specs have no replicas key.
  if (spec.replicas !== undefined) {
    const { rows } = await pool.query(
      "SELECT (spec->>'replicas')::int AS replicas FROM workspace_placements WHERE workspace_id = $1",
      [workspaceId],
    )
    const live = rows[0]?.replicas
    if (typeof live === 'number') spec.replicas = live
  }
  await pool.query(
    `UPDATE workspace_placements
        SET spec_version = spec_version + 1,
            spec = jsonb_set($2::jsonb, '{version}', to_jsonb(spec_version + 1))
      WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(spec)],
  )
}
