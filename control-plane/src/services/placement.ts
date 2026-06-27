import { pool } from './db/pool'
import { getWorkspaceConfig } from './db/workspaces'

// Desired-state writes for the BYOI placement queue. After the P1 control
// inversion, cp no longer calls k8s directly — it records *desired* state here
// and the env-runner (built-in or remote) converges actual → desired. The target
// environment is chosen at create time (see placement-decision.ts).

const BUILTIN_ENV = 'builtin'

/** Build the infra-agnostic spec the runner applies, from workspace_config. */
function specFrom(agentType: string, resources: unknown, version: number) {
  return { agentType, resources: resources ?? {}, version }
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
  const spec = specFrom(config?.agent_type || 'claude-code', config?.compute_resources, 1)
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
  const spec = specFrom(config?.agent_type || 'claude-code', config?.compute_resources, 0)
  await pool.query(
    `UPDATE workspace_placements
        SET spec_version = spec_version + 1,
            spec = jsonb_set($2::jsonb, '{version}', to_jsonb(spec_version + 1))
      WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(spec)],
  )
}
