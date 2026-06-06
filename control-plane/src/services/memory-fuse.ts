import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { type MemoryAccess, listAttachmentsForStore } from './db/memory'

const NAMESPACE = process.env.K8S_NAMESPACE || 'default'
const PROTO_PATH =
  process.env.MEMORY_FUSE_PROTO_PATH || path.resolve(process.cwd(), 'proto/memory-fuse.proto')

const pkgDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})
const pkg = grpc.loadPackageDefinition(pkgDef).memoryfuse as any

// No client cache. We tried one — but caching held stale connections
// across pod rebuilds (the migration's reconcile pass surfaced this:
// after every ws Deployment was recreated, cp's cached clients still
// pointed at dead pod IPs, and RPCs hung indefinitely). gRPC-js dedupes
// channels by target internally, so per-call construction is just an
// object alloc with no real network cost.
function getClient(workspaceId: string) {
  const addr = `tos-${workspaceId}.${NAMESPACE}.svc:9102`
  return new pkg.MemoryFuseService(addr, grpc.credentials.createInsecure())
}

// Cap every gRPC call so a slow / unreachable daemon can't pin the route
// handler open. The DB side already committed by the time we dial Mount,
// so a deadline miss just degrades us to "next sidecar boot pull catches
// up" — which is the same path stopped ws already use.
const GRPC_DEADLINE_MS = 5000

function unary<TReq, TRes>(client: any, method: string, req: TReq): Promise<TRes> {
  const deadline = new Date(Date.now() + GRPC_DEADLINE_MS)
  return new Promise((resolve, reject) => {
    client[method](req, { deadline }, (err: grpc.ServiceError | null, res: TRes) => {
      if (err) reject(err)
      else resolve(res)
    })
  })
}

/**
 * Tell the ws's memory-fuse sidecar to mount a store at /mnt/memory/<store_id>/.
 * Idempotent: re-issuing the same store_id overwrites the read_only flag
 * (used by PATCH attachment access changes).
 */
export async function mountStore(
  workspaceId: string,
  input: { storeId: string; access: MemoryAccess },
): Promise<void> {
  await unary<{ store_id: string; read_only: boolean }, { mountpoint: string }>(
    getClient(workspaceId),
    'Mount',
    {
      store_id: input.storeId,
      read_only: input.access === 'read_only',
    },
  )
}

export async function unmountStore(workspaceId: string, storeId: string): Promise<void> {
  await unary<{ store_id: string }, Record<string, never>>(getClient(workspaceId), 'Unmount', {
    store_id: storeId,
  })
}

/**
 * Tell every workspace currently mounting `storeId` to drop its content
 * cache for that store. Fire-and-forget: failures (unreachable daemon,
 * 9102 not yet listening) are logged but don't fail the caller. cp invokes
 * this from the post-success path of memory writes and deletes so attached
 * sidecars see fresh data on the next read instead of waiting for the
 * snapshot poll tick.
 *
 * Fires in the background — callers don't await. Each ws gets its own
 * deadline via the gRPC client's default timeout; one slow ws can't hold
 * up the others.
 */
export function broadcastStoreInvalidate(storeId: string): void {
  void (async () => {
    try {
      const attachments = await listAttachmentsForStore(storeId)
      await Promise.all(
        attachments.map(async (a) => {
          try {
            await unary<{ store_id: string }, Record<string, never>>(
              getClient(a.workspace_id),
              'Invalidate',
              { store_id: storeId },
            )
          } catch (e) {
            console.warn(
              `[memory-fuse] Invalidate ws=${a.workspace_id} store=${storeId} failed:`,
              e,
            )
          }
        }),
      )
    } catch (e) {
      console.warn(`[memory-fuse] broadcast invalidate failed store=${storeId}:`, e)
    }
  })()
}
