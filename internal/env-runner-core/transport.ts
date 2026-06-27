/**
 * The cp↔runner placement transport — the seam that lets one reconcile core
 * serve two runner shapes:
 *   - DbTransport   (built-in / same-cluster): reads/writes workspace_placements
 *                   directly over a pg pool.
 *   - HttpTransport (remote / BYOI): calls the /env/v1 protocol with an env
 *                   token; cp scopes every query to the token's environment.
 *
 * Both speak the same snake_case PlacementRow shape — which is exactly the JSON
 * the /env/v1/placements endpoint returns and the workspace_placements columns
 * the db transport selects — so the core never needs to know which side it talks
 * to. See tmp/byoi-environments-design.md §5.
 */

/** A placement as the runner sees it (db columns / protocol JSON, 1:1). */
export interface PlacementRow {
  workspace_id: string
  environment_id: string
  desired_phase: string
  spec: unknown
  spec_version: number
  observed_phase: string | null
  observed_version: number | null
}

/** Observed-state write-back. version is set only post-apply (convergence). */
export interface ObservedUpdate {
  phase: string
  endpoint?: unknown
  message?: string | null
  version?: number | null
}

export interface PlacementTransport {
  /** Desired-state set this runner is responsible for. */
  listPlacements(): Promise<PlacementRow[]>
  /** Report observed state for one workspace. */
  writeObserved(workspaceId: string, o: ObservedUpdate): Promise<void>
  /** Drop a placement row after destroy. */
  deletePlacement(workspaceId: string): Promise<void>
  /** Liveness + capability refresh, once per reconcile pass. */
  heartbeat(capabilities: Record<string, unknown>): Promise<void>
}
