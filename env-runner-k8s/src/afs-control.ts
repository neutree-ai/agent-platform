import path from 'node:path'
import type { Duplex } from 'node:stream'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { serveControl } from '../../internal/env-tunnel'

// Runner-side afs orchestration (BYOI option A). cp cannot reach a remote
// environment's afs-controller/afs-fuse — they live in the customer cluster on a
// RWX data plane that can't cross the WAN. Instead cp opens an `afsctl` control
// stream over the tunnel and the runner, which IS in-cluster, executes the afs
// gRPC calls locally (controller via cluster DNS, fuse via the workspace pod's
// Service) and returns the result. This mirrors the built-in path in
// control-plane/src/services/afs.ts — same proto, same ops — just relocated to
// where the afs data plane actually lives.

const NAMESPACE = process.env.K8S_NAMESPACE || 'default'
const NAME_PREFIX = 'tos' // must match internal/k8s-provider NAME_PREFIX
const AFS_CONTROLLER_ADDR =
  process.env.AFS_CONTROLLER_ADDR || `afs-controller.${NAMESPACE}.svc:9100`
const AFS_DEFAULT_FS = process.env.AFS_DEFAULT_FS || 'shared'
const AFS_DEFAULT_FS_BASE_PATH = process.env.AFS_DEFAULT_FS_BASE_PATH || '/data/afs'
// Mirrors control-plane/proto/afs.proto; shipped in the runner image at
// ./proto/afs.proto (cwd = /app/env-runner-k8s).
const AFS_PROTO_PATH = process.env.AFS_PROTO_PATH || path.resolve(process.cwd(), 'proto/afs.proto')

let afsPkg: any
function pkg() {
  if (!afsPkg) {
    const def = protoLoader.loadSync(AFS_PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })
    afsPkg = (grpc.loadPackageDefinition(def) as any).afs
  }
  return afsPkg
}

let controllerClient: any
function controller() {
  if (!controllerClient) {
    controllerClient = new (pkg().ControllerService)(
      AFS_CONTROLLER_ADDR,
      grpc.credentials.createInsecure(),
    )
  }
  return controllerClient
}

const fuseClients: Record<string, any> = {}
function fuse(workspaceId: string) {
  let c = fuseClients[workspaceId]
  if (!c) {
    const addr = `${NAME_PREFIX}-${workspaceId}.${NAMESPACE}.svc:9101`
    c = new (pkg().FuseService)(addr, grpc.credentials.createInsecure())
    fuseClients[workspaceId] = c
  }
  return c
}

function unary(client: any, method: string, req: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    client[method](req, (err: grpc.ServiceError | null, res: unknown) =>
      err ? reject(err) : resolve(res),
    )
  })
}

async function dispatch(req: any): Promise<unknown> {
  switch (req?.op) {
    case 'ensureDefaultFs': {
      try {
        await unary(controller(), 'RegisterFs', {
          name: AFS_DEFAULT_FS,
          fs_type: 'local',
          config: { base_path: AFS_DEFAULT_FS_BASE_PATH },
        })
      } catch (e) {
        if ((e as grpc.ServiceError).code !== grpc.status.ALREADY_EXISTS) throw e
      }
      return { ok: true }
    }
    case 'createDir': {
      const r = await unary(controller(), 'CreateDir', { fs_name: req.fsName || AFS_DEFAULT_FS })
      return { id: r.id, accessKey: r.access_key, permission: r.permission }
    }
    case 'revokeDir': {
      const r = await unary(controller(), 'RevokeDir', { id: req.id, access_key: req.accessKey })
      return { sessionsRevoked: r.sessions_revoked }
    }
    case 'mount': {
      await unary(fuse(req.workspaceId), 'Mount', {
        id: req.dirId,
        access_key: req.accessKey,
        mountpoint: `/mnt/afs/${req.name}`,
        // The fuse-server validates against THIS cluster's controller.
        controller_addr: AFS_CONTROLLER_ADDR,
        readonly: !!req.readonly,
      })
      return { ok: true }
    }
    case 'unmount': {
      await unary(fuse(req.workspaceId), 'Unmount', { mountpoint: `/mnt/afs/${req.name}` })
      return { ok: true }
    }
    default:
      throw new Error(`unknown afs op: ${req?.op}`)
  }
}

/** Handle an `afsctl` control stream cp opened: one request → one response. */
export function handleAfsControl(stream: Duplex): void {
  void serveControl(stream, dispatch)
}
