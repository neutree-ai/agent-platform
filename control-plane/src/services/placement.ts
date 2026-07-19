import { pool } from './db/pool'
import { getWorkspaceConfig } from './db/workspaces'

// Desired-state writes for the BYOI placement queue. After the P1 control
// inversion, cp no longer calls k8s directly — it records *desired* state here
// and the env-runner (built-in or remote) converges actual → desired. The target
// environment is chosen at create time (see placement-decision.ts).

const BUILTIN_ENV = 'builtin'

/**
 * Build the infra-agnostic spec the runner applies, from a workspace_config
 * row (null → platform defaults). Pure — this is the single place where
 * config columns are projected into the placement spec, so growing the spec
 * means adding a field here (and a column migration), not editing callers.
 */
export function buildWorkspaceSpec(
  config: {
    agent_type?: string | null
    compute_resources?: unknown
    auto_scaling?: { min_replicas: number } | null
  } | null,
  version: number,
): {
  agentType: string
  resources: unknown
  version: number
  runtimeMode?: 'auto-scaling'
  replicas?: number
} {
  const base = {
    agentType: config?.agent_type || 'claude-code',
    resources: config?.compute_resources ?? {},
    version,
  }
  // The presence of auto_scaling is the shape discriminant: absent → static,
  // which projects byte-identically (no new fields, so the Deployment it becomes
  // is unchanged) and, by construction, cannot read a replica count. An
  // auto-scaling workspace carries the shape and an initial count:
  // max(min_replicas, 1) so a freshly-created one is runnable before the
  // autoscaler's first pass (and before scale-to-zero can apply). Once the
  // autoscaler exists it owns the count via setDesiredReplicas, and a config
  // bump must preserve it there.
  if (!config?.auto_scaling) return base
  return {
    ...base,
    runtimeMode: 'auto-scaling',
    replicas: Math.max(config.auto_scaling.min_replicas, 1),
  }
}

/**
 * Place a freshly-created workspace on an environment: desired=running, spec from
 * its config, spec_version=1 with observed_version=0 so the runner applies
 * (creates the pod) on its next pass. Records the environment on workspace_config
 * too (design §3.4). Idempotent — a re-create bumps the spec instead.
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

/** Set the desired phase (running | stopped | deleted). */
export async function setDesiredPhase(
  workspaceId: string,
  phase: 'running' | 'stopped' | 'deleted',
): Promise<void> {
  await pool.query('UPDATE workspace_placements SET desired_phase = $2 WHERE workspace_id = $1', [
    workspaceId,
    phase,
  ])
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
