import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import {
  type PluginMetadata,
  deletePlugin,
  getPluginBundle,
  listPlugins,
  setPluginEnabled,
  upsertPlugin,
} from '../services/db/plugins'

const plugins = new Hono<AppEnv>()

const MAX_BUNDLE_BYTES = 20 * 1024 * 1024 // 20 MB
const MAX_BUNDLE_LABEL = '20 MB'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION_RE = /^[a-zA-Z0-9._+-]{1,64}$/

// Public manifest — every authenticated client uses this on boot.
plugins.get('/', async (c) => {
  const rows = await listPlugins({ enabledOnly: true })
  return c.json(
    rows.map((r) => ({
      id: r.id,
      version: r.version,
      bundleUrl: `/api/plugins/${r.id}/bundle.js?v=${encodeURIComponent(r.version)}`,
      // Lazy plugins skip boot-time injection; the host loads the bundle
      // on first interaction with a surface declared in `owns`. Absent
      // metadata ⇒ legacy eager plugin.
      lazy: r.metadata?.lazy ?? false,
      owns: r.metadata?.owns ?? null,
    })),
  )
})

plugins.get('/:id/bundle.js', async (c) => {
  const id = c.req.param('id')
  const row = await getPluginBundle(id)
  if (!row) return c.json({ error: 'Not found' }, 404)
  // Versioned URL → safe to cache aggressively. The URL changes whenever the
  // version changes, so stale browser/CDN caches simply pull the new URL.
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  c.header('ETag', `"${id}-${row.version}"`)
  return c.body(new Uint8Array(row.bundle))
})

// ── Admin ─────────────────────────────────────────────────────────────────
// Outer auth middleware already grants admin via PLUGIN_ADMIN_TOKEN for
// CI/rollout, or JWT cookie for admin users. Route-level just checks role.

const admin = new Hono<AppEnv>()
admin.use('*', async (c, next) => {
  const user = c.get('user')
  if (user?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  return next()
})

admin.get('/list', async (c) => {
  const rows = await listPlugins()
  return c.json(rows)
})

admin.post('/', async (c) => {
  const form = await c.req.formData()
  const id = String(form.get('id') ?? '')
  const version = String(form.get('version') ?? '')
  const description = form.get('description')
  const file = form.get('bundle')
  const metadataField = form.get('metadata')

  if (!ID_RE.test(id)) return c.json({ error: 'Invalid plugin id' }, 400)
  if (!VERSION_RE.test(version)) return c.json({ error: 'Invalid version' }, 400)
  if (!(file instanceof File)) return c.json({ error: 'bundle is required' }, 400)
  if (file.size > MAX_BUNDLE_BYTES) {
    return c.json(
      {
        error: `Bundle too large: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_BUNDLE_LABEL} limit`,
      },
      400,
    )
  }

  // Optional plugin.json — when present, declares lazy + owned surfaces
  // (panels / tool renderers / tool handlers). Validated as JSON only;
  // shape is trusted (uploader is admin-authenticated). Absent ⇒ NULL ⇒
  // legacy eager plugin behaviour preserved.
  let metadata: PluginMetadata | null = null
  if (typeof metadataField === 'string' && metadataField.trim()) {
    try {
      metadata = JSON.parse(metadataField) as PluginMetadata
    } catch {
      return c.json({ error: 'metadata must be valid JSON' }, 400)
    }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  await upsertPlugin({
    id,
    version,
    description: typeof description === 'string' && description ? description : null,
    bundle: buf,
    metadata,
  })
  return c.json({ id, version, bundle_size: buf.byteLength, lazy: metadata?.lazy ?? false })
})

admin.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ enabled?: boolean }>()
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: '`enabled` must be boolean' }, 400)
  }
  const ok = await setPluginEnabled(id, body.enabled)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.json({ id, enabled: body.enabled })
})

admin.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const ok = await deletePlugin(id)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

plugins.route('/admin', admin)

export default plugins
