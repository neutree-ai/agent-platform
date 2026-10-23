import { attachStore, createStore } from './db/memory'
import { isMemoryFuseAvailable } from './k8s'

/**
 * Give a new workspace its default memory store, attached read-write.
 *
 * Its builtin Reflect schedule is NOT created here — reconcileReflectSchedule
 * (called from startWorkspaceInstance) creates it the first time the
 * workspace actually starts, which also covers workspaces whose store
 * predates this feature, so there's only one code path that creates a
 * Reflect schedule. Skipped when the cluster doesn't ship the memory-fuse
 * image (sidecar wouldn't be present — store would just be dead weight in
 * the prompt) or the environment has no persistent memory.
 */
export async function attachDefaultMemoryStore(args: {
  workspaceId: string
  userId: string
  name: string
  persistentMemory: boolean
}): Promise<void> {
  if (!isMemoryFuseAvailable() || !args.persistentMemory) return
  try {
    // Reuse the workspace name verbatim so the store is identifiable from
    // the user's locale without cp needing an i18n layer. Description is
    // left empty — the user can edit either in the Memory app later.
    const store = await createStore({
      ownerUserId: args.userId,
      name: args.name,
      originWorkspaceId: args.workspaceId,
    })
    await attachStore({ workspaceId: args.workspaceId, storeId: store.id, access: 'read_write' })
  } catch (e: any) {
    // Don't fail ws creation if the memory bootstrap trips — user can
    // still attach a store later via the global Memory app.
    console.error(`[workspace ${args.workspaceId}] auto-attach memory store failed:`, e.message)
  }
}
