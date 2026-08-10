/**
 * The runtime shape of a workspace — the one discriminator the platform branches
 * on when static and auto-scaling workspaces genuinely differ.
 *
 * A workspace is, at any instant, N replicas of a given size:
 *
 * - `'static'` — N pinned to 0 or 1, driven by the desired phase. One replica on
 *   a ReadWriteOnce volume, behind a ClusterIP Service.
 * - `'auto-scaling'` — N in [min, max], driven by the autoscaler. Replicas share
 *   one ReadWriteMany volume, reached through per-ordinal headless DNS. Requires
 *   the environment to advertise the `multiReplica` capability.
 *
 * Fixed at creation and immutable after.
 *
 * Differences that are only a matter of *how many* replicas — turn capacity,
 * reload fan-out, status projection, usage accounting — are expressed in that
 * N-replica model and do not branch. Only differences in *shape* branch, and
 * every one of them does so through an exhaustive `switch` over this type with
 * {@link assertNever} in the default arm. Importing this module therefore marks
 * a fork point: `grep -l "from '.*runtime-mode'"` enumerates all of them, and
 * adding a third mode fails the build at each until it is handled.
 */
export type RuntimeMode = 'static' | 'auto-scaling'

/**
 * Default arm of an exhaustive `switch`. The parameter narrows to `never` only
 * when every case is covered, so an unhandled variant is a compile error; the
 * throw covers a value that reached here from outside the type system.
 *
 * The value being switched on must reach the `switch` as a full `RuntimeMode`,
 * which in practice means coming out of a function whose RETURN TYPE says so:
 *
 *     function runtimeModeOf(x): RuntimeMode { return x.foo ? 'auto-scaling' : 'static' }
 *     const mode = runtimeModeOf(x)          // RuntimeMode — exhaustive
 *     const mode: RuntimeMode = x.foo ? 'auto-scaling' : 'static'   // NOT exhaustive
 *
 * A `const` initialised from a literal expression is narrowed to just the
 * literals that expression can produce, and the annotation does not stop it. The
 * `switch` then covers that narrowed type, this arm still sees `never`, and the
 * build keeps passing when a mode is added — silently losing the guarantee.
 */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`)
}
