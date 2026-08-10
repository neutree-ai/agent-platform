import type { WorkspaceSpec } from '../types/environments'
import type { RuntimeMode } from '../types/runtime-mode'

const RUNTIME_MODES: readonly RuntimeMode[] = ['static', 'auto-scaling']

/**
 * Turn a stored placement spec (opaque JSON on the row / in the protocol
 * payload) into a typed {@link WorkspaceSpec}.
 *
 * This is the one place a spec crosses from JSON into the type system, so it is
 * where the shape is established rather than assumed:
 *
 * - a spec with no `runtimeMode` is a single-replica Deployment, `'static'` —
 *   the reading that predates the field
 * - a spec naming a mode this build does not know is rejected here, where the
 *   payload is still in hand to name in the error. Letting it through would
 *   reach `assertNever` in a provider's switch, which is the type system's
 *   "impossible" arm and says nothing about what actually arrived.
 *
 * Past this function `runtimeMode` is required, which is what lets every
 * downstream `switch` be exhaustive instead of defaulting on its own.
 */
export function toWorkspaceSpec(raw: unknown): WorkspaceSpec {
  const spec = raw as WorkspaceSpec
  if (spec.runtimeMode === undefined) return { ...spec, runtimeMode: 'static' }
  if (!RUNTIME_MODES.includes(spec.runtimeMode)) {
    throw new Error(`unknown workspace runtimeMode: ${JSON.stringify(spec.runtimeMode)}`)
  }
  return spec
}
