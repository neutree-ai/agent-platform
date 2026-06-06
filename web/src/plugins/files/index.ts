/**
 * Files plugin — owns the "workspace files have changed" refresh signal.
 *
 * Tools the agent commonly uses to mutate files (Edit/Write/apply_patch,
 * Bash/Run shell fallback, MCP share_folder/grant_access/unshare_from_all)
 * trigger a debounced bump on `filesStore`. Consumers subscribe via
 * `filesRefresh.useToken()` and re-fetch when it changes.
 *
 * Third parties can call `filesRefresh.bump()` directly from their own
 * tool-result handlers if their tool also mutates files.
 */

import type { WorkspacePlugin } from '@/plugins/types'
import { create } from 'zustand'

interface FilesRefreshState {
  token: number
  bump: () => void
}

const useFilesStore = create<FilesRefreshState>((set) => ({
  token: 0,
  bump: () => set((s) => ({ token: s.token + 1 })),
}))

export const filesRefresh = {
  bump: () => useFilesStore.getState().bump(),
  useToken: () => useFilesStore((s) => s.token),
}

// Agents often produce Write → Edit → Edit in quick succession; coalesce.
const FILES_REFRESH_DEBOUNCE_MS = 500

// Match when the tool name *contains* one of these identifiers as a
// word-boundary segment. Used for MCP-namespaced tools where the name
// arrives as e.g. "mcp__tos-platform__share_folder".
const wordBoundary = (names: string[]) =>
  new RegExp(`(?:^|[./:_-])(${names.join('|')})(?:$|[./:_-])`, 'i')

// Match when the tool name *starts with* one of these (Claude emits the
// bare name "Edit"; Codex prefixes "Edit /path", "Run pwd"). Anchored to
// avoid substring false positives like `skill_enter_edit`.
const exactOrPrefix = (names: string[]) => new RegExp(`^(${names.join('|')})(?:\\s|$)`)

const builtinFileEdits = exactOrPrefix(['Edit', 'Write', 'apply_patch'])
const afsShareMutations = wordBoundary(['share_folder', 'grant_access', 'unshare_from_all'])
const shellFallback = exactOrPrefix(['Bash', 'Run', 'execute'])

export const filesPlugin: WorkspacePlugin = {
  id: 'files',
  toolResultHandlers: [
    {
      id: 'files.builtin-edits',
      match: ({ toolName }) => builtinFileEdits.test(toolName),
      debounceMs: FILES_REFRESH_DEBOUNCE_MS,
      onMatch: () => filesRefresh.bump(),
    },
    {
      id: 'files.afs-share-mutations',
      match: ({ toolName }) => afsShareMutations.test(toolName),
      debounceMs: FILES_REFRESH_DEBOUNCE_MS,
      onMatch: () => filesRefresh.bump(),
    },
    {
      id: 'files.shell-fallback',
      match: ({ toolName }) => shellFallback.test(toolName),
      debounceMs: FILES_REFRESH_DEBOUNCE_MS,
      onMatch: () => filesRefresh.bump(),
    },
  ],
}
