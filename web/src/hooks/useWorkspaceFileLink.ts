import { useSlotContext } from '@/contexts/SlotContext'
import { type DriveKind, dirListUrl } from '@/lib/api/agent-files'
import { parseWorkspaceFileHref } from '@/lib/workspace-file-link'
import { setPersistentInstanceStateMany } from '@/stores/instance-state-store'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'

interface WorkspaceFileLinkHandlers {
  /** Inline click → swap the slotted Files panel to this file/dir. */
  onLinkClick: () => void
  /** External-link icon click → spawn a fresh popout viewer. */
  onPopoutClick: () => void
}

// Cache directory probes per (workspaceId, drive, path). Same path on
// different drives can resolve differently, so the drive must be part of the
// key. Resolved entries never change for the life of the page, so repeated
// clicks on the same link don't re-fetch.
const probeCache = new Map<string, Promise<boolean>>()

function probeIsDir(
  workspaceId: string | undefined,
  drive: DriveKind,
  filePath: string,
): Promise<boolean> {
  if (!workspaceId) return Promise.resolve(filePath.endsWith('/'))
  // Always probe with a trailing slash: dufs 301-redirects bare directory
  // paths to their trailing-slash form but drops the `?json` query on the
  // way, causing the proxy to see HTML instead of a listing.
  const probePath = filePath.endsWith('/') ? filePath : `${filePath}/`
  const cacheKey = `${workspaceId}:${drive}:${probePath}`
  const cached = probeCache.get(cacheKey)
  if (cached) return cached
  const p = fetch(dirListUrl(workspaceId, probePath, undefined, drive))
    .then((resp) => resp.ok)
    .catch(() => false)
  probeCache.set(cacheKey, p)
  return p
}

/**
 * Resolve an agent-emitted file href (e.g. `/workspace/foo.md`,
 * `/mnt/afs/share/x.txt`, `/workspace/bar.ts:42:5`) into click handlers that
 * drive the Files app:
 *
 *  - `onLinkClick` swaps the slotted Files instance to the target, switching
 *    drives if the file lives on a different storage than the one currently
 *    shown — the panel reads `drive` + `viewingPath` from its persistent
 *    state, so seeding both is enough.
 *  - `onPopoutClick` spawns a fresh popout `FileApp` seeded with the same
 *    fields; directories fall back to the slotted panel since browsing a
 *    folder in a floating window is awkward.
 *
 * Returns `null` for hrefs that don't match a known workspace prefix, so
 * callers can fall through to plain `<a target="_blank">`.
 */
export function useWorkspaceFileLink(href: string | undefined): WorkspaceFileLinkHandlers | null {
  const slotCtx = useSlotContext()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const parsed = useMemo(() => parseWorkspaceFileHref(href), [href])

  return useMemo(() => {
    // Bail out entirely when there's no slot context or workspace to route
    // into — the previous markdown-inline version conditionally hid the
    // popout button in this case; null-returning here preserves that.
    if (!parsed || !slotCtx || !workspaceId) return null
    const { drive, filePath, viewingLine, viewingColumn } = parsed

    const navigateToPanel = (isDir: boolean) => {
      const normalized = isDir ? (filePath.endsWith('/') ? filePath : `${filePath}/`) : filePath
      const { slotId, instanceId } = slotCtx.ensureInstance('files')
      // Always write line/col/drive so a fresh link without an anchor clears
      // any leftover from a prior click on the same panel, and switches the
      // panel to the right storage if it was on a different one.
      setPersistentInstanceStateMany(workspaceId, instanceId, {
        viewingPath: normalized,
        viewingLine,
        viewingColumn,
        drive,
      })
      slotCtx.activate(slotId, instanceId)
    }

    const openInPopout = (isDir: boolean) => {
      if (isDir) {
        navigateToPanel(true)
        return
      }
      slotCtx.openInPopout('file', {
        viewingPath: filePath,
        viewingLine,
        viewingColumn,
        drive,
      })
    }

    return {
      onLinkClick: () => {
        void probeIsDir(workspaceId, drive, filePath).then(navigateToPanel)
      },
      onPopoutClick: () => {
        void probeIsDir(workspaceId, drive, filePath).then(openInPopout)
      },
    }
  }, [parsed, slotCtx, workspaceId])
}
