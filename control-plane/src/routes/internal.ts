import { Hono } from 'hono'
import { listAfsMountsForWorkspace } from '../services/db/afs-shares'

const internal = new Hono()

// Health check
internal.get('/health', (c) => c.json({ status: 'ok' }))

// afs-fuse sidecar boot pull: list of AFS shares this ws should mount.
// Daemon hits this on startup (via AFS_BOOTSTRAP_URL env), Mounts each at
// /mnt/afs/<share_name>. This is the single source of truth for "what
// should be mounted in this pod" — cp no longer pushes remounts from
// reconcile/lifecycle because the pod's own startup is a more reliable
// event source than cp's deployment-level watch. Grant/revoke during a
// running pod still go through mountAtWorkspace/unmountAtWorkspace
// (push), since those happen mid-lifetime when no startup event fires.
internal.get('/workspaces/:id/afs-mounts', async (c) => {
  const id = c.req.param('id')
  const rows = await listAfsMountsForWorkspace(id)
  return c.json({
    mounts: rows.map((r) => ({
      id: r.afs_dir_id,
      access_key: r.access_key,
      mountpoint: `/mnt/afs/${r.share_name}`,
      readonly: r.permission === 'read_only',
    })),
  })
})

export default internal
