/**
 * Data-access contract for the skill browser shell.
 *
 * Two surfaces consume the same shell today and one more is on the way:
 *   - workspace authoring (WorkspaceSkillsPanel) — read + write + drag-move
 *   - library preview (planned, phase 1b-3) — read-only catalog browsing
 *
 * A `SkillBrowserSource` abstracts everything fs-shaped: skill list, dir
 * listing, file URL, and optional write actions. Authoring-lifecycle
 * concepts (publish, editing flag, draft creation, removal) deliberately
 * stay out — they live one layer up in the wrapper that owns them, since
 * the library has no analogue.
 *
 * Cache safety: the shell uses react-query, but its internal queryKeys
 * compose `cacheNamespace` so two sources mounted in the same tree don't
 * step on each other's caches.
 */
import type { DufsEntry } from '../file-operations'

export type { DufsEntry }

/**
 * Minimal contract the shell relies on. Concrete sources extend this with
 * surface-specific fields (`editing`, `description`, etc.) that the wrapper
 * — not the shell — reads via the `getSkillExtras` slot.
 */
export interface SkillListItem {
  name: string
}

export interface SkillBrowserSource<TSkill extends SkillListItem = SkillListItem> {
  /**
   * Disambiguates react-query cache entries. e.g. `['skill-browser-workspace', wsId]`
   * vs `['skill-browser-library']`. The shell appends its own segments.
   */
  cacheNamespace: readonly unknown[]

  fetchSkills(): Promise<TSkill[]>
  fetchDir(skillName: string, subPath: string): Promise<DufsEntry[]>

  /**
   * The path FileViewer should fetch from. `entryPath` is the
   * leading-slash-relative path within the skill (e.g. `/scripts/x.ts`,
   * or `''` for the root).
   *
   * Workspace authoring returns an absolute container path like
   * `/.claude/skills/<name>/scripts/x.ts`; library will return a
   * skill-relative path that the library FileViewer flavor knows how to
   * resolve to the catalog endpoint.
   */
  fileLocator(skillName: string, entryPath: string): string

  /**
   * Optional write capabilities. When absent the shell hides every mutate
   * affordance (menu items, +file/+folder buttons, drag-and-drop).
   */
  writes?: SkillBrowserWrites
}

interface SkillBrowserWrites {
  createFile(skillName: string, parentPath: string, name: string): Promise<{ entryPath: string }>
  deleteEntry(skillName: string, entryPath: string, isDir: boolean): Promise<void>
  mkdir(skillName: string, parentPath: string, name: string): Promise<void>
  move(skillName: string, fromEntryPath: string, toEntryPath: string): Promise<void>

  /**
   * Called once after any successful mutation. Wrapper-level concerns
   * (e.g. invalidating the workspace's enabled-skills query because
   * editing flipped) hook in here so the shell doesn't have to know.
   */
  onAfterMutate?(skillName: string): Promise<void> | void
}
