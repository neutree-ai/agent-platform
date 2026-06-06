import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

const AFS_CONTROLLER_ADDR = process.env.AFS_CONTROLLER_ADDR || 'afs-controller.default.svc:9100'
const AFS_DEFAULT_FS = process.env.AFS_DEFAULT_FS || 'shared'
const AFS_DEFAULT_FS_BASE_PATH = process.env.AFS_DEFAULT_FS_BASE_PATH || '/data/afs'
const AFS_PROTO_PATH = process.env.AFS_PROTO_PATH || path.resolve(process.cwd(), 'proto/afs.proto')
const NAMESPACE = process.env.K8S_NAMESPACE || 'default'

const pkgDef = protoLoader.loadSync(AFS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const afsPkg = grpc.loadPackageDefinition(pkgDef).afs as any

const controllerClient = new afsPkg.ControllerService(
  AFS_CONTROLLER_ADDR,
  grpc.credentials.createInsecure(),
)

const fuseClients: Record<string, any> = {}
function getFuseClient(workspaceId: string) {
  let c = fuseClients[workspaceId]
  if (!c) {
    const addr = `tos-${workspaceId}.${NAMESPACE}.svc:9101`
    c = new afsPkg.FuseService(addr, grpc.credentials.createInsecure())
    fuseClients[workspaceId] = c
  }
  return c
}

function unary<TReq, TRes>(client: any, method: string, req: TReq): Promise<TRes> {
  return new Promise((resolve, reject) => {
    client[method](req, (err: grpc.ServiceError | null, res: TRes) => {
      if (err) reject(err)
      else resolve(res)
    })
  })
}

type Permission = 'READ_ONLY' | 'READ_WRITE'

interface AfsDir {
  id: string
  accessKey: string
  permission: Permission
}

export async function createDir(fsName = AFS_DEFAULT_FS): Promise<AfsDir> {
  const res = await unary<
    { fs_name: string },
    { id: string; access_key: string; permission: Permission }
  >(controllerClient, 'CreateDir', { fs_name: fsName })
  return { id: res.id, accessKey: res.access_key, permission: res.permission }
}

export async function revokeDir(id: string, accessKey: string): Promise<number> {
  const res = await unary<
    { id: string; access_key: string },
    { sessions_revoked: number; errors: number }
  >(controllerClient, 'RevokeDir', { id, access_key: accessKey })
  return res.sessions_revoked
}

/**
 * Mount a directory inside the given workspace's afs-fuse sidecar via its
 * Service DNS name (port 9101). The fuse-server then validates the token
 * with the controller and mounts at /mnt/afs/<name>.
 */
export async function mountAtWorkspace(
  workspaceId: string,
  dirId: string,
  accessKey: string,
  name: string,
  readonly = false,
): Promise<void> {
  const mountpoint = `/mnt/afs/${name}`
  await unary<
    {
      id: string
      access_key: string
      mountpoint: string
      controller_addr: string
      readonly: boolean
    },
    { mountpoint: string }
  >(getFuseClient(workspaceId), 'Mount', {
    id: dirId,
    access_key: accessKey,
    mountpoint,
    controller_addr: AFS_CONTROLLER_ADDR,
    readonly,
  })
}

export async function unmountAtWorkspace(workspaceId: string, name: string): Promise<void> {
  const mountpoint = `/mnt/afs/${name}`
  await unary<{ mountpoint: string }, Record<string, never>>(
    getFuseClient(workspaceId),
    'Unmount',
    { mountpoint },
  )
}

/** Register the default fs once. Safe to call repeatedly. */
export async function ensureDefaultFs(): Promise<void> {
  try {
    await unary(controllerClient, 'RegisterFs', {
      name: AFS_DEFAULT_FS,
      fs_type: 'local',
      config: { base_path: AFS_DEFAULT_FS_BASE_PATH },
    })
  } catch (e) {
    if ((e as grpc.ServiceError).code === grpc.status.ALREADY_EXISTS) return
    throw e
  }
}
