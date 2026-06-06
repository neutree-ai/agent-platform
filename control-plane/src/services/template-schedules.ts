import * as jobs from '../lib/jobs'
import {
  createSchedule,
  deleteSchedule,
  listSchedulesByWorkspace,
  updateSchedule,
} from './db/schedules'
import { getTemplateVersion } from './db/templates'
import type { TemplateVersionSchedule } from './db/types'

/**
 * Schedules are an *active* template capability: unlike commands (resolved at
 * read time), a template schedule must be materialized into a real `schedules`
 * row and registered with pg-boss to actually fire. These helpers own that
 * materialization for the two paths that pull a template version into a
 * workspace — create (materialize) and sync (reconcile by name).
 *
 * Template schedules carry `origin='template'`. They are read-only except
 * enable/disable; the user's enabled toggle lives on the materialized row and is
 * preserved across sync. `enabledOverrides` (name → enabled) is the recipient's
 * consent result; absent entries fall back to the version's `enabled_default`.
 */

async function materializeOne(
  workspaceId: string,
  userId: string,
  def: TemplateVersionSchedule,
  enabled: boolean,
): Promise<void> {
  const schedule = await createSchedule({
    workspace_id: workspaceId,
    user_id: userId,
    name: def.name,
    cron: def.cron,
    run_at: null,
    timezone: def.timezone,
    prompt: def.prompt,
    prompt_id: def.prompt_id,
    origin: 'template',
    enabled,
  })
  if (!enabled) return
  try {
    const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
    if (pgbossJobId) await updateSchedule(schedule.id, { pgboss_job_id: pgbossJobId })
  } catch {
    // Registration failed — leave the row but disabled-in-effect rather than
    // claiming it's active.
    await updateSchedule(schedule.id, { enabled: false, pgboss_job_id: null })
  }
}

/** Materialize all of a template version's schedules into a fresh workspace. */
export async function materializeTemplateSchedules(args: {
  workspaceId: string
  userId: string
  templateId: string
  version: number
  enabledOverrides?: Record<string, boolean>
}): Promise<void> {
  const tv = await getTemplateVersion(args.templateId, args.version)
  if (!tv) return
  for (const def of tv.schedules) {
    const enabled = args.enabledOverrides?.[def.name] ?? def.enabled_default
    await materializeOne(args.workspaceId, args.userId, def, enabled)
  }
}

/**
 * Reconcile a workspace's template-origin schedules against a (new) template
 * version, by name: drop removed ones, add new ones (honoring consent /
 * enabled_default), and refresh changed definitions while preserving the user's
 * enabled toggle.
 */
export async function reconcileTemplateSchedules(args: {
  workspaceId: string
  userId: string
  templateId: string
  version: number
  enabledOverrides?: Record<string, boolean>
}): Promise<void> {
  const tv = await getTemplateVersion(args.templateId, args.version)
  const defs = tv?.schedules ?? []
  const defByName = new Map(defs.map((d) => [d.name, d]))

  const existing = (await listSchedulesByWorkspace(args.workspaceId)).filter(
    (s) => s.origin === 'template',
  )
  const existingByName = new Map(existing.map((s) => [s.name, s]))

  // Removed in the new version → unregister + delete.
  for (const s of existing) {
    if (!defByName.has(s.name)) {
      await jobs.cancelScheduleTimer(s)
      await deleteSchedule(s.id)
    }
  }

  for (const def of defs) {
    const cur = existingByName.get(def.name)
    if (!cur) {
      const enabled = args.enabledOverrides?.[def.name] ?? def.enabled_default
      await materializeOne(args.workspaceId, args.userId, def, enabled)
      continue
    }
    // Refresh definition if it changed; keep the user's enabled toggle.
    const defChanged =
      cur.cron !== def.cron ||
      cur.timezone !== def.timezone ||
      cur.prompt !== def.prompt ||
      (cur.prompt_id ?? null) !== (def.prompt_id ?? null)
    if (!defChanged) continue
    await jobs.cancelScheduleTimer(cur)
    const updated = await updateSchedule(cur.id, {
      cron: def.cron,
      timezone: def.timezone,
      prompt: def.prompt,
      prompt_id: def.prompt_id,
    })
    if (updated?.enabled) {
      const pgbossJobId = await jobs.enqueueScheduleTimer(updated)
      if (pgbossJobId !== updated.pgboss_job_id) {
        await updateSchedule(updated.id, { pgboss_job_id: pgbossJobId })
      }
    }
  }
}
