/**
 * Workspace authoring surface for skills — list + file tree + viewer.
 *
 * The tree-and-viewer view itself lives in `skill-browser/SkillBrowserShell`,
 * which is also the basis for the (planned) library preview page. This
 * wrapper supplies the workspace-only bits the shell stays agnostic about:
 *
 *   - workspace-bound data source (agent dufs scoped to /.claude/skills/<name>)
 *   - draft creation / skill removal / publish lifecycle
 *   - "*" suffix on in-edit skills inside the picker
 *   - publish button above the tree
 *   - `skillsRefresh` plugin signal (fired by agent MCP tool results)
 *   - FileViewer composition (workspace-bound today)
 */
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isCommitEnter } from '@/lib/keyboard'
import { skillsRefresh } from '@/plugins/skills'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileViewer } from './FileViewer'
import { type SkillBrowserController, SkillBrowserShell } from './skill-browser/SkillBrowserShell'
import {
  type WorkspaceSkillEntry,
  createWorkspaceSkillSource,
  enabledSkillsQueryKey,
  workspaceSkillUrls,
} from './skill-browser/workspace-source'

interface WorkspaceEnabledSkillEntry {
  id: string
  name: string
  editable?: boolean
  gitSource?: boolean
}

interface WorkspaceEnabledSkillsResponse {
  skills?: WorkspaceEnabledSkillEntry[]
}

interface WorkspaceSkillsPanelProps {
  workspaceId: string
  instanceId: string
}

export function WorkspaceSkillsPanel({ workspaceId, instanceId }: WorkspaceSkillsPanelProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const skillsRefreshToken = skillsRefresh.useToken()

  // Build the workspace data source once per workspaceId. The source carries
  // its own cache namespace and write actions; the shell consumes it.
  const source = useMemo(
    () => createWorkspaceSkillSource({ workspaceId, queryClient: qc }),
    [workspaceId, qc],
  )
  const skillsListKey = useMemo(
    () => [...source.cacheNamespace, 'skills'] as const,
    [source.cacheNamespace],
  )

  // Shadow query: same key as the shell's, so we read the cached list
  // react-query already has without firing a second request.
  const skillsQuery = useQuery<WorkspaceSkillEntry[]>({
    queryKey: skillsListKey,
    queryFn: () => source.fetchSkills(),
  })
  const skills = skillsQuery.data ?? []

  // Imperative shell controller — lets us drive selection synchronously
  // alongside our remove/publish mutations (no empty-frame between the
  // mutation and the auto-pick-next effect).
  const controllerRef = useRef<SkillBrowserController | null>(null)

  // ── refresh signal from the agent's skill-management MCP tools ───────────
  useEffect(() => {
    if (skillsRefreshToken === 0) return
    qc.invalidateQueries({ queryKey: source.cacheNamespace })
  }, [skillsRefreshToken, qc, source.cacheNamespace])

  // ── header state: remove arm-then-confirm, new-draft dialog ──────────────
  const [removeArmed, setRemoveArmed] = useState(false)
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(removeTimerRef.current), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')

  // Shared helper for publish/remove. p3 cp returns `{id, name, ...}` per
  // enabled skill — we keep both around because publish/remove still match
  // by name (the in-container filesystem identity), but the PUT body now
  // requires UUIDs.
  const fetchEnabledSkills = useCallback(async (): Promise<WorkspaceEnabledSkillEntry[]> => {
    const data = await qc.fetchQuery<WorkspaceEnabledSkillsResponse>({
      queryKey: enabledSkillsQueryKey(workspaceId),
      queryFn: async () => {
        const resp = await fetch(workspaceSkillUrls.workspaceSkills(workspaceId), {
          credentials: 'include',
        })
        if (!resp.ok) return { skills: [] }
        return resp.json()
      },
    })
    return data.skills ?? []
  }, [qc, workspaceId])

  // ── lifecycle mutations ──────────────────────────────────────────────────
  const createDraftMutation = useMutation({
    mutationFn: async (name: string) => {
      const resp = await fetch(workspaceSkillUrls.skillsApi(workspaceId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || t('components.workspaceSkillsPanel.errors.createDraftFailed'))
      }
      return name
    },
    onSuccess: async (name) => {
      setCreateOpen(false)
      setNewName('')
      await qc.invalidateQueries({ queryKey: skillsListKey })
      controllerRef.current?.selectSkill(name)
      toast.success(t('components.workspaceSkillsPanel.toasts.createdDraft', { name }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const createDraft = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed) return
    createDraftMutation.mutate(trimmed)
  }, [newName, createDraftMutation])

  const removeSkillMutation = useMutation({
    mutationFn: async (name: string) => {
      const resp = await fetch(
        `${workspaceSkillUrls.skillsApi(workspaceId)}/${encodeURIComponent(name)}`,
        { method: 'DELETE', credentials: 'include' },
      )
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || t('components.workspaceSkillsPanel.errors.removeFailed'))
      }
      // Drop from workspace_skills so the next pod restart doesn't reload
      // it. p3 PUT body carries UUIDs; we match the row by container name
      // (still the local filesystem identity) and forward the remaining
      // ids.
      try {
        const current = await fetchEnabledSkills()
        const target = current.find((s) => s.name === name)
        if (target) {
          await fetch(workspaceSkillUrls.workspaceSkills(workspaceId), {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skills: current.filter((s) => s.id !== target.id).map((s) => s.id),
            }),
          })
        }
      } catch {
        // best-effort
      }
      return name
    },
    onSuccess: async (name) => {
      // The header remove button is only visible while a skill is selected,
      // so the skill we just deleted is, by construction, the active one.
      // Switch selection synchronously to avoid the empty-frame between the
      // delete and the shell's auto-pick-next effect.
      const remaining = skills.filter((s) => s.name !== name)
      controllerRef.current?.selectSkill(remaining[0]?.name ?? null)
      await Promise.all([
        qc.invalidateQueries({ queryKey: skillsListKey }),
        qc.invalidateQueries({ queryKey: enabledSkillsQueryKey(workspaceId) }),
      ])
      toast.success(t('components.workspaceSkillsPanel.toasts.removed', { name }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const publishSkillMutation = useMutation({
    mutationFn: async (name: string) => {
      // 1. Pack on agent pod
      const packResp = await fetch(`${workspaceSkillUrls.skillsApi(workspaceId)}/${name}/pack`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!packResp.ok) throw new Error(t('components.workspaceSkillsPanel.errors.packFailed'))
      const blob = await packResp.blob()

      // 2. Upload to CP (POST upserts on (user_id, name) — works for both
      //    new and existing skills; returns the ApiSkill with its UUID).
      const uploadResp = await fetch(
        `/api/skills?name=${encodeURIComponent(name)}&description=&visibility=private`,
        { method: 'POST', credentials: 'include', body: blob },
      )
      if (!uploadResp.ok) {
        const err = await uploadResp.json().catch(() => ({}))
        throw new Error(err.error || t('components.workspaceSkillsPanel.errors.uploadFailed'))
      }
      const uploaded = (await uploadResp.json()) as { id: string; name: string }

      // 3. Ensure this skill is enabled for the current workspace. p3
      //    workspace_skills is keyed by UUID; we feed the freshly created
      //    skill id alongside the others (deduped by id).
      try {
        const current = await fetchEnabledSkills()
        if (!current.some((s) => s.id === uploaded.id)) {
          await fetch(workspaceSkillUrls.workspaceSkills(workspaceId), {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skills: [...current.map((s) => s.id), uploaded.id],
            }),
          })
        }
      } catch {
        // best-effort
      }

      // 4. Stop editing
      await fetch(`${workspaceSkillUrls.skillsApi(workspaceId)}/${name}/stop-edit`, {
        method: 'POST',
        credentials: 'include',
      })
      return name
    },
    onSuccess: async (name) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: skillsListKey }),
        qc.invalidateQueries({ queryKey: enabledSkillsQueryKey(workspaceId) }),
      ])
      toast.success(t('components.workspaceSkillsPanel.toasts.published', { name }))
    },
    onError: (e: any) => toast.error(e.message),
  })

  const removingName = removeSkillMutation.isPending
    ? (removeSkillMutation.variables ?? null)
    : null
  const packingName = publishSkillMutation.isPending
    ? (publishSkillMutation.variables ?? null)
    : null

  return (
    <>
      <SkillBrowserShell<WorkspaceSkillEntry>
        source={source}
        instanceId={instanceId}
        sidebarStorageKey="tos-skills-sidebar-width"
        controllerRef={controllerRef}
        getSkillExtras={(skill) => (skill.editing ? ' *' : null)}
        renderHeaderExtras={({ selectedSkill }) => (
          <>
            <AppHeaderButton
              icon={Plus}
              title={t('components.workspaceSkillsPanel.actions.newDraft')}
              onClick={() => setCreateOpen(true)}
            />
            {selectedSkill && (
              <AppHeaderButton
                icon={removeArmed ? Check : Trash2}
                title={t('components.workspaceSkillsPanel.tooltips.remove')}
                tone="destructive"
                disabled={removingName === selectedSkill.name}
                onClick={() => {
                  if (removeArmed) {
                    setRemoveArmed(false)
                    clearTimeout(removeTimerRef.current)
                    removeSkillMutation.mutate(selectedSkill.name)
                  } else {
                    setRemoveArmed(true)
                    removeTimerRef.current = setTimeout(() => setRemoveArmed(false), 3000)
                  }
                }}
              />
            )}
          </>
        )}
        renderTreeHeader={({ selectedSkill }) => {
          if (!selectedSkill?.editable || !selectedSkill?.editing) return null
          const tooltipText = selectedSkill.gitSource
            ? t('components.workspaceSkillsPanel.tooltips.publishGitSource')
            : t('components.workspaceSkillsPanel.tooltips.publish')
          return (
            <div className="border-b border-foreground/[0.06] px-2 py-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    className="h-7 w-full text-xs gap-1.5"
                    disabled={packingName === selectedSkill.name}
                    onClick={() => publishSkillMutation.mutate(selectedSkill.name)}
                  >
                    {packingName === selectedSkill.name ? (
                      <Spinner size="sm" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {t('components.workspaceSkillsPanel.actions.publish')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-64 text-xs">
                  {tooltipText}
                </TooltipContent>
              </Tooltip>
            </div>
          )
        }}
        renderFileViewer={({ skillName, fileLocator, onSave, headerSlot }) => (
          <FileViewer
            workspaceId={workspaceId}
            instanceId={instanceId}
            filePath={fileLocator}
            // FileViewer's save PUTs the file directly through agent dufs
            // (bypassing source.writes). We splice markEditing in here so
            // the .editing lockfile stays fresh on every save, matching
            // the pre-refactor behavior of `handleFileSaved`.
            onSave={async () => {
              await source.markEditing(skillName)
              await onSave?.()
            }}
            headerSlot={headerSlot}
          />
        )}
      />

      {/* Create-draft dialog — purely wrapper-local UI, lives outside the shell. */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('components.workspaceSkillsPanel.dialogs.newDraft.title')}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t('components.workspaceSkillsPanel.dialogs.newDraft.placeholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => isCommitEnter(e) && createDraft()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={createDraft}
              disabled={createDraftMutation.isPending || !newName.trim()}
            >
              {createDraftMutation.isPending ? <Spinner size="sm" className="mr-1.5" /> : null}
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
