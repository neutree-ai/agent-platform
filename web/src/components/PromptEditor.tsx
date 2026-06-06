import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Combobox } from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import type {
  ApiPrompt,
  ApiPromptVersion,
  ApiTeam,
  PromptGrant,
  PromptPermission,
  PromptVisibility,
} from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, History, Lock, RotateCcw, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface PromptEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt?: ApiPrompt | null
  /** Called after a successful save with the created/updated prompt. */
  onSaved: (prompt?: ApiPrompt) => void
  readOnly?: boolean
  /** Restrict the dialog to visibility + grants only. Owner-only entry point
   *  triggered from the "Share" button — hides name/content/version UI. */
  shareOnly?: boolean
}

export function PromptEditor({
  open,
  onOpenChange,
  prompt,
  onSaved,
  readOnly,
  shareOnly,
}: PromptEditorProps) {
  const { t } = useTranslation()
  const isEditing = !!prompt
  const isOwner = prompt?.is_own ?? true
  const myPermission = prompt?.my_permission
  const canEditContent = !readOnly && (isOwner || myPermission === 'editor')
  const canEditMeta = !readOnly && isOwner

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<PromptVisibility>('private')
  // Map of team_id -> permission. Each team gets its own role.
  const [teamGrants, setTeamGrants] = useState<Record<string, PromptPermission>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [versions, setVersions] = useState<ApiPromptVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const { data: teams = [] } = useQuery<ApiTeam[]>({
    queryKey: ['teams'],
    queryFn: () => api.listTeams(),
    enabled: open && canEditMeta,
  })

  // Load existing grants when editing an owned team-shared prompt
  useEffect(() => {
    if (!open || !prompt || !canEditMeta) return
    if (prompt.visibility !== 'team') {
      setTeamGrants({})
      return
    }
    api
      .listPromptGrants(prompt.id)
      .then((grants) => {
        const next: Record<string, PromptPermission> = {}
        for (const g of grants) next[g.team_id] = g.permission as PromptPermission
        setTeamGrants(next)
      })
      .catch(() => {})
  }, [open, prompt, canEditMeta])

  useEffect(() => {
    if (open) {
      if (prompt) {
        setName(prompt.name)
        setContent(prompt.content)
        setVisibility(prompt.visibility)
      } else {
        setName('')
        setContent('')
        setVisibility('private')
        setTeamGrants({})
      }
      setError(null)
      setVersions([])
      setVersionsOpen(false)
    }
  }, [open, prompt])

  useEffect(() => {
    if (versionsOpen && prompt) {
      setVersionsLoading(true)
      api
        .listPromptVersions(prompt.id)
        .then(setVersions)
        .catch(() => {})
        .finally(() => setVersionsLoading(false))
    }
  }, [versionsOpen, prompt])

  function toggleTeam(id: string) {
    setTeamGrants((prev) => {
      if (id in prev) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: 'viewer' }
    })
  }
  function setTeamPermission(id: string, perm: PromptPermission) {
    setTeamGrants((prev) => ({ ...prev, [id]: perm }))
  }

  async function handleSave() {
    if (!shareOnly && !name.trim()) {
      setError(t('components.promptEditor.errors.nameRequired'))
      return
    }
    const teamIds = Object.keys(teamGrants)
    if (canEditMeta && visibility === 'team' && teamIds.length === 0) {
      setError(t('components.promptEditor.errors.teamRequired'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const grants: PromptGrant[] | undefined = canEditMeta
        ? visibility === 'team'
          ? teamIds.map((team_id) => ({ team_id, permission: teamGrants[team_id] }))
          : []
        : undefined

      let saved: ApiPrompt
      if (isEditing) {
        const payload: Parameters<typeof api.updatePrompt>[1] = shareOnly
          ? {}
          : { name: name.trim(), content }
        if (canEditMeta) {
          payload.visibility = visibility
          payload.grants = grants
        }
        saved = await api.updatePrompt(prompt.id, payload)
        toast.success(t('components.promptEditor.toasts.updated'))
      } else {
        saved = await api.createPrompt({
          name: name.trim(),
          content,
          visibility,
          grants: grants && grants.length > 0 ? grants : undefined,
        })
        toast.success(t('components.promptEditor.toasts.created'))
      }
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('components.promptEditor.errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRollback(version: number) {
    if (!prompt) return
    try {
      const updated = await api.rollbackPrompt(prompt.id, version)
      setContent(updated.content)
      toast.success(t('components.promptEditor.toasts.rolledBack', { version }))
      const newVersions = await api.listPromptVersions(prompt.id)
      setVersions(newVersions)
      onSaved()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.promptEditor.errors.rollbackFailed'),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          shareOnly
            ? 'sm:max-w-md max-h-[90vh] overflow-y-auto'
            : 'sm:max-w-5xl max-h-[90vh] overflow-y-auto'
        }
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {shareOnly
              ? t('components.promptEditor.titles.share', { name: prompt?.name ?? '' })
              : readOnly
                ? t('components.promptEditor.titles.view')
                : isEditing
                  ? t('components.promptEditor.titles.edit')
                  : t('components.promptEditor.titles.new')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!shareOnly && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">{t('components.promptEditor.fields.name')}</Label>
                <Input
                  className="h-7 text-xs"
                  placeholder={t('components.promptEditor.placeholders.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={!canEditContent}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('components.promptEditor.fields.content')}</Label>
                <Textarea
                  className="min-h-[50vh] font-mono text-xs focus-visible:ring-inset"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t('components.promptEditor.placeholders.content')}
                  readOnly={!canEditContent}
                />
              </div>
            </>
          )}

          {canEditMeta && (
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="flex flex-col gap-1.5">
                <Label className="block text-xs">
                  {t('components.promptEditor.fields.visibility')}
                </Label>
                <SegmentedControl<PromptVisibility>
                  variant="box"
                  size="md"
                  value={visibility}
                  onValueChange={setVisibility}
                  options={[
                    {
                      value: 'private',
                      label: t('components.promptEditor.visibility.private'),
                      icon: Lock,
                    },
                    {
                      value: 'team',
                      label: t('components.promptEditor.visibility.team'),
                      icon: Users,
                    },
                    {
                      value: 'public',
                      label: t('components.promptEditor.visibility.public'),
                    },
                  ]}
                />
              </div>
              {visibility === 'team' && (
                <div className="flex flex-col gap-1.5">
                  <Label className="block text-tiny text-muted-foreground">
                    {t('components.promptEditor.fields.teams')}
                  </Label>
                  {teams.length === 0 ? (
                    <div className="text-tiny text-muted-foreground">
                      {t('components.promptEditor.teamsEmpty')}
                    </div>
                  ) : (
                    <>
                      {Object.keys(teamGrants).length === 0 ? (
                        <div className="text-tiny text-muted-foreground/70">
                          {t('components.promptEditor.noTeamsShared')}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {Object.entries(teamGrants).map(([teamId, perm]) => {
                            const team = teams.find((x) => x.id === teamId)
                            return (
                              <div
                                key={teamId}
                                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5"
                              >
                                <span className="min-w-0 flex-1 truncate text-xs">
                                  {team?.name ?? teamId}
                                </span>
                                <SegmentedControl<PromptPermission>
                                  variant="pill"
                                  size="sm"
                                  value={perm}
                                  onValueChange={(v) => setTeamPermission(teamId, v)}
                                  options={[
                                    {
                                      value: 'viewer',
                                      label: t('components.promptEditor.permission.viewer'),
                                    },
                                    {
                                      value: 'editor',
                                      label: t('components.promptEditor.permission.editor'),
                                    },
                                  ]}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => toggleTeam(teamId)}
                                  title={t('components.promptEditor.removeTeam')}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {teams.some((tm) => !(tm.id in teamGrants)) && (
                        <Combobox
                          placeholder={t('components.promptEditor.addTeam')}
                          value=""
                          onValueChange={(id) => id && toggleTeam(id)}
                          options={teams
                            .filter((tm) => !(tm.id in teamGrants))
                            .map((tm) => ({ value: tm.id, label: tm.name }))}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {!canEditMeta && isEditing && prompt && (
            <div className="flex items-center gap-1.5 text-tiny text-muted-foreground">
              <Badge variant="outline" className="font-normal">
                {t(`components.promptEditor.visibility.${prompt.visibility}`)}
              </Badge>
              {!isOwner && (
                <span>{t('components.promptEditor.ownedBy', { name: prompt.owner_name })}</span>
              )}
            </div>
          )}

          {!shareOnly && isEditing && canEditContent && (
            <Collapsible open={versionsOpen} onOpenChange={setVersionsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start gap-1.5 text-xs text-muted-foreground"
                >
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${versionsOpen ? 'rotate-90' : ''}`}
                  />
                  <History className="h-3 w-3" />
                  {t('components.promptEditor.versionHistory.title', {
                    version: prompt.current_version,
                  })}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {versionsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner size="sm" />
                  </div>
                ) : versions.length === 0 ? (
                  <div className="py-2 text-center text-xs text-muted-foreground">
                    {t('components.promptEditor.versionHistory.empty')}
                  </div>
                ) : (
                  <ScrollArea className="max-h-36">
                    <div className="space-y-1 pr-3 pt-1">
                      {versions.map((v) => (
                        <div
                          key={v.version}
                          className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-medium">v{v.version}</span>
                            <span className="ml-2 text-tiny text-muted-foreground">
                              {new Date(v.created_at).toLocaleString()}
                            </span>
                          </div>
                          {v.version !== prompt.current_version && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={() => handleRollback(v.version)}
                              title={t('components.promptEditor.versionHistory.rollbackTitle')}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {readOnly ? t('components.promptEditor.actions.close') : t('common.cancel')}
          </Button>
          {canEditContent && (
            <SaveButton
              isSaving={isSaving}
              onClick={handleSave}
              label={isEditing ? t('common.update') : t('common.create')}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
