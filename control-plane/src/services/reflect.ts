import { getStoreById, listAttachmentsForWorkspace, setStoreReflectSchedule } from './db/memory'
import { createSchedule, getSchedule, updateSchedule } from './db/schedules'
import { getWorkspace } from './db/workspaces'
import { isMemoryFuseAvailable } from './k8s'
import { buildReflectPrompt } from './reflect-prompt'

/** Default cadence for an auto-created Reflect schedule: daily at 03:00 UTC. */
const DEFAULT_REFLECT_CRON = '0 3 * * *'

/**
 * Per-turn catch-up chunk: how far past its checkpoint a single Reflect turn
 * is allowed to advance. Bounds one turn's workload regardless of how far
 * behind the schedule has fallen (disabled for months, repeatedly failing,
 * or simply never run before on a store that predates this feature) —
 * without ever permanently skipping the gap the way a hard lookback cap
 * would. A store further behind than this just takes multiple scheduled
 * runs to catch up; each one picks up exactly where the last left off.
 */
const REFLECT_CATCHUP_CHUNK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The [since, until) window a Reflect turn is allowed to look at and is
 * responsible for once it succeeds. `turnCreatedAt` anchors "now" to the
 * triggering session's own created_at (rather than each caller taking its
 * own wall-clock reading) so `list_recent_activity` (mcp/tools/reflect.ts)
 * and the eventual checkpoint-advance step (reflect/end) compute byte-
 * identical bounds from the same two persisted facts — no state needs to be
 * threaded between them.
 */
export function reflectWindow(
  store: { last_reflected_at: string | null; created_at: string },
  turnCreatedAt: string,
): { since: string; until: string } {
  const since = store.last_reflected_at ?? store.created_at
  const untilMs = Math.min(
    new Date(turnCreatedAt).getTime(),
    new Date(since).getTime() + REFLECT_CATCHUP_CHUNK_MS,
  )
  return { since, until: new Date(untilMs).toISOString() }
}

/**
 * Create the builtin Reflect schedule for a workspace's own memory store and
 * link the store back to it (memory_stores.reflect_schedule_id). The link
 * lives on the store, not on `schedules` — `schedules` stays a generic
 * "cron/one-shot -> workspace chat" primitive shared with template and
 * user-created schedules, with no awareness of Reflect.
 *
 * `origin: 'reflect'` makes the prompt platform-managed (routes/workspaces/
 * schedules.ts rejects edits to `prompt`/`prompt_id` and blocks deletion for
 * this origin) — see reconcileReflectSchedule for how it stays in sync with
 * buildReflectPrompt. Deliberately NOT `origin: 'template'`:
 * reconcileTemplateSchedules matches schedules by name against a template
 * version's defs and deletes ones it can't find, which would delete this
 * schedule the moment the workspace's template version bumped.
 *
 * Created **disabled** by default: task 9 (review mode) and task 10 (Memory
 * app / Schedules UI surfacing what this is) aren't built yet, and the
 * feature hasn't run in production at all — auto-enabling it would mean
 * every workspace starts silently editing its own memory daily with zero
 * visible explanation. The user turns it on per-workspace once they want to
 * try it (`enabled` is a normal editable field even for `origin: 'reflect'`
 * — see routes/workspaces/schedules.ts). Flip this default once review
 * mode + UI ship and the mechanism has some real mileage on it.
 *
 * Mirrors `materializeOne` in template-schedules.ts: skip pg-boss
 * registration entirely for a disabled row (nothing to fire), and on
 * registration failure for an enabled one, leave the row but flip it
 * disabled rather than claim it's active. Never throws — a Reflect
 * bootstrap failure should not block whatever reconcile pass is calling it.
 *
 * Only called from reconcileReflectSchedule below — not exported. There is
 * deliberately no eager call at workspace-creation time; the first
 * reconcile (on the workspace's first start) creates it.
 */
async function createReflectSchedule(args: {
  workspaceId: string
  userId: string
  storeId: string
}): Promise<void> {
  const schedule = await createSchedule({
    workspace_id: args.workspaceId,
    user_id: args.userId,
    name: 'Memory Reflect',
    cron: DEFAULT_REFLECT_CRON,
    run_at: null,
    timezone: 'UTC',
    prompt: buildReflectPrompt(args.storeId),
    prompt_id: null,
    origin: 'reflect',
    enabled: false,
  })
  await setStoreReflectSchedule(args.storeId, schedule.id)
}

/**
 * Keep a workspace's Reflect schedule in sync: create it if the workspace's
 * own store doesn't have one yet (covers workspaces created before this
 * feature shipped — no one-off backfill script needed, this runs every time
 * the workspace starts), and refresh a stale prompt in place (safe to
 * overwrite unconditionally — `origin: 'reflect'` schedules reject prompt
 * edits at the API layer, so a mismatch only ever means "we shipped a new
 * buildReflectPrompt since this schedule was created/last reconciled", never
 * a user customization).
 *
 * Only acts when the workspace has exactly one attached store — zero means
 * memory wasn't provisioned for it (predates the feature, or the cluster
 * lacks the memory-fuse image), more than one means the store is shared
 * across workspaces (see memory-store-plan.md 3.1: auto-reflect is
 * deliberately scoped to a store's single owning workspace to avoid
 * concurrent Reflect turns racing on the same store).
 *
 * Called from startWorkspaceInstance, the same lazy "fix drift on open"
 * chokepoint reconcileWorkspacePod uses for the pod spec.
 */
export async function reconcileReflectSchedule(workspaceId: string): Promise<void> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace || workspace.is_system || !isMemoryFuseAvailable()) return

  const attachments = await listAttachmentsForWorkspace(workspaceId)
  if (attachments.length !== 1) return
  const storeId = attachments[0].store_id

  const store = await getStoreById(storeId)
  const schedule = store?.reflect_schedule_id ? await getSchedule(store.reflect_schedule_id) : null
  if (!schedule) {
    await createReflectSchedule({ workspaceId, userId: workspace.user_id, storeId })
    return
  }
  const expectedPrompt = buildReflectPrompt(storeId)
  if (schedule.origin === 'reflect' && schedule.prompt !== expectedPrompt) {
    await updateSchedule(schedule.id, { prompt: expectedPrompt })
  }
}
