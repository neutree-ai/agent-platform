import {
  DEFAULT_LAYOUT_ID,
  extractSkeletonFromProfile,
  layoutSkeletonEqual,
  skeletonToProfilePatch,
} from '../../../internal/types/api'
import { getTemplate, getTemplateVersion } from './db/templates'
import {
  getTemplateLayoutCopy,
  getWorkspaceLayout,
  upsertTemplateLayoutCopy,
} from './db/workspace-layout'
import { getWorkspaceProfile, patchWorkspaceProfile } from './db/workspace-profile'

/**
 * Layout is shipped by a template as a *link* (template_versions.layout_id) and
 * delivered COPY-ON-RECEIPT: create/sync resolve the builder's referenced row,
 * copy its current skeleton into a recipient-owned `origin='template'` row, and
 * point the workspace's `selected_layout_id` at that copy. A dangling/absent
 * link ships no layout (the workspace stays on the built-in default).
 *
 * Instance ids are minted deterministically so re-materializing the same
 * skeleton doesn't churn the profile.
 */
const mkInstanceId = (slotId: string, appId: string, i: number) => `${slotId}:${appId}:${i}`

/** Resolve the live skeleton a template version ships, or null (no/dangling link). */
async function resolveShippedLayout(templateId: string, version: number) {
  const tv = await getTemplateVersion(templateId, version)
  if (!tv?.layout_id) return null
  const src = await getWorkspaceLayout(tv.layout_id)
  return src ?? null
}

/** Materialize a template version's layout into a freshly-created workspace. */
export async function materializeTemplateLayout(args: {
  workspaceId: string
  userId: string
  templateId: string
  version: number
}): Promise<void> {
  const src = await resolveShippedLayout(args.templateId, args.version)
  if (!src) return
  // Builder using their own template: the referenced layout is already theirs —
  // select it directly, no redundant template copy. Copy-on-receipt is only for
  // cross-owner delivery.
  if (src.owner_id === args.userId) {
    await patchWorkspaceProfile(args.workspaceId, {
      selected_layout_id: src.id,
      ...skeletonToProfilePatch(src.skeleton, mkInstanceId),
    })
    return
  }
  const tpl = await getTemplate(args.templateId)
  const copy = await upsertTemplateLayoutCopy(
    args.userId,
    args.templateId,
    tpl?.name || 'Template layout',
    src.skeleton,
  )
  await patchWorkspaceProfile(args.workspaceId, {
    selected_layout_id: copy.id,
    ...skeletonToProfilePatch(src.skeleton, mkInstanceId),
  })
}

/**
 * Reconcile a workspace's template-origin layout against a (new) template
 * version on sync. Always refreshes the recipient's copy row to the version's
 * current skeleton. Touches the workspace's live arrangement only when it is
 * still *selecting* that copy: if it was unedited (same), auto-adopt the new
 * skeleton; if edited, leave it (the user pulls via Reset). If the workspace
 * selected something else, only the Library row is refreshed.
 */
export async function reconcileTemplateLayout(args: {
  workspaceId: string
  userId: string
  templateId: string
  version: number
}): Promise<void> {
  const src = await resolveShippedLayout(args.templateId, args.version)
  if (!src) return // new version ships no layout → leave the recipient's as-is

  // Builder's own layout is live — no copy to reconcile; their selection already
  // tracks it. Leave their current selection untouched.
  if (src.owner_id === args.userId) return

  const oldCopy = await getTemplateLayoutCopy(args.userId, args.templateId)
  const profile = await getWorkspaceProfile(args.workspaceId)
  const wasSelectingCopy = !!oldCopy && profile.selected_layout_id === oldCopy.id
  const wasSame =
    wasSelectingCopy &&
    layoutSkeletonEqual(extractSkeletonFromProfile(profile, DEFAULT_LAYOUT_ID), oldCopy!.skeleton)

  const tpl = await getTemplate(args.templateId)
  const copy = await upsertTemplateLayoutCopy(
    args.userId,
    args.templateId,
    tpl?.name || 'Template layout',
    src.skeleton,
  )

  if (wasSelectingCopy && wasSame) {
    // Pristine recipient riding the template layout → adopt the new one.
    await patchWorkspaceProfile(args.workspaceId, {
      selected_layout_id: copy.id,
      ...skeletonToProfilePatch(src.skeleton, mkInstanceId),
    })
  }
}
