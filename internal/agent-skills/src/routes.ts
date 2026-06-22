/**
 * Skill management route handlers.
 *
 * Framework-agnostic: returns a record of { method, handler } that the caller
 * mounts on their own Hono app. No direct Hono dependency in this package.
 *
 * Usage in agent server:
 *   import { registerSkillRoutes } from '.../agent-skills/src/routes.js'
 *   registerSkillRoutes(app, '/skills', getSkillManager)
 */

import type { SkillManager } from './index.js'

interface RouteApp {
  get(path: string, handler: (c: any) => any): void
  post(path: string, handler: (c: any) => any): void
  delete(path: string, handler: (c: any) => any): void
}

/**
 * Register skill management routes on a Hono app instance.
 * @param app    - The Hono app to mount routes on
 * @param prefix - Route prefix, e.g. '/skills'
 * @param getManager - Returns the SkillManager instance (may be null before init)
 */
export function registerSkillRoutes(
  app: RouteApp,
  prefix: string,
  getManager: () => SkillManager | null,
): void {
  function mgr(): SkillManager {
    const m = getManager()
    if (!m) throw new Error('SkillManager not initialized')
    return m
  }

  // List locally extracted skills with editing status
  app.get(`${prefix}`, async (c: any) => {
    try {
      const names = await mgr().listLocal()
      const m = mgr()
      const skills = names.map((name: string) => ({
        name,
        editing: m.isEditing(name),
        editable: m.isEditable(name),
        gitSource: m.isGitSource(name),
      }))
      return c.json({ skills, filesBrowsePath: m.filesBrowsePath })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Check editing status for a skill
  app.get(`${prefix}/:name/status`, (c: any) => {
    try {
      const name = c.req.param('name')
      return c.json({ name, editing: mgr().isEditing(name) })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Start editing a skill (create .editing lockfile)
  app.post(`${prefix}/:name/edit`, async (c: any) => {
    try {
      const name = c.req.param('name')
      await mgr().startEditing(name)
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Stop editing a skill (remove .editing lockfile)
  app.post(`${prefix}/:name/stop-edit`, async (c: any) => {
    try {
      const name = c.req.param('name')
      await mgr().stopEditing(name)
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Create a new draft skill
  app.post(`${prefix}`, async (c: any) => {
    try {
      const { name } = await c.req.json()
      if (!name) return c.json({ error: 'name is required' }, 400)
      const m = mgr()
      await m.createDraft(name)
      return c.json({ success: true, name, path: `${m.filesBrowsePath}/${name}` })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Remove a skill locally (unlink symlink + delete /tmp cache)
  app.delete(`${prefix}/:name`, async (c: any) => {
    try {
      const name = c.req.param('name')
      await mgr().remove(name)
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // Pack a skill into tar.gz for download/upload
  app.post(`${prefix}/:name/pack`, async (c: any) => {
    try {
      const name = c.req.param('name')
      const buf = await mgr().pack(name)
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.tar.gz`,
        },
      })
    } catch (e: any) {
      // Surface the underlying tar/exec failure (e.g. "exited with code 1",
      // which previously vanished) so pack failures are diagnosable in logs.
      console.error(`[skills] pack_failed name=${c.req.param('name')} error=${e?.message}`)
      return c.json({ error: e.message }, 500)
    }
  })
}
