import { listMcpCatalogByHook } from '../services/db/mcp-catalog'

const HOOK_TIMEOUT = 5000

/** Fire on_delete hooks for all registered services. Best-effort, never throws. */
export async function fireDeleteHooks(workspaceId: string): Promise<void> {
  const entries = await listMcpCatalogByHook('on_delete')
  await Promise.allSettled(
    entries.map(async (entry) => {
      const url = entry.hooks.on_delete!
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId }),
          signal: AbortSignal.timeout(HOOK_TIMEOUT),
        })
        console.log(`[service-hook] on_delete ${entry.id}: ${res.status}`)
      } catch (e: any) {
        console.warn(`[service-hook] on_delete ${entry.id} failed:`, e.message)
      }
    }),
  )
}
