import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { AppHeaderSearch } from '@/components/shell/windows/AppHeaderSearch'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Spinner } from '@/components/ui/spinner'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { useTags } from '@/hooks/useTags'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import type { Tag } from '@/lib/api/types'
import type { AppComponentProps } from '@/lib/app-registry'
import { getTagColor } from '@/lib/tag-colors'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

interface WsCardData {
  id: string
  name: string
  visibility: string
  status: string
  created_at: string
  tag_ids: string[]
  active_agent_sessions: number
  active_human_sessions: number
}

/**
 * Workspaces — fleet-scope app showing the workspace grid. Lives in
 * slot-b of the fleet 3-col layout by default; users can drag it to any
 * slot. Replaces the old monolithic HomeApp's "ws list" section.
 */
export function WorkspacesApp(_: AppComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const headerSlot = useAppHeaderSlot()
  const { open: openDialog } = useDialogStack()
  const [search, setSearch] = useState('')
  const [filterTagIds, setFilterTagIds] = useState<Set<string>>(new Set())

  const { data: workspaces, isLoading } = useWorkspaces()
  const { data: tags } = useTags()
  const tagsById = useMemo(() => {
    const map = new Map<string, Tag>()
    for (const tag of tags ?? []) map.set(tag.id, tag)
    return map
  }, [tags])

  const filtered = useMemo(() => {
    const list = workspaces ?? []
    const q = search.trim().toLowerCase()
    const f = list.filter((ws) => {
      if (q && !ws.name.toLowerCase().includes(q)) return false
      if (filterTagIds.size > 0 && !ws.tag_ids?.some((id) => filterTagIds.has(id))) return false
      return true
    })
    return [...f].sort((a, b) => {
      const score = (w: typeof a) =>
        w.active_human_sessions * 1000 +
        w.active_agent_sessions * 10 +
        (w.status === 'running' ? 1 : 0)
      const sa = score(a)
      const sb = score(b)
      if (sa !== sb) return sb - sa
      return b.created_at.localeCompare(a.created_at)
    })
  }, [workspaces, search, filterTagIds])

  function toggleTag(tagId: string) {
    setFilterTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.shell.workspacesApp.actions.new')}
              onClick={() => openDialog('create-workspace')}
            />
            <AppHeaderSearch
              value={search}
              onChange={setSearch}
              placeholder={t('components.shell.workspacesApp.searchPlaceholder')}
            />
          </>,
          headerSlot,
        )}

      {tags && tags.length > 0 && (
        <div className="shrink-0 border-b border-foreground/[0.04] px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const color = getTagColor(tag.color)
              const active = filterTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-mini font-medium transition-colors',
                    active
                      ? cn(color.bg, 'text-white shadow-sm')
                      : cn(color.text, 'hover:bg-foreground/[0.05]'),
                  )}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-foreground/[0.08] bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
            {workspaces && workspaces.length === 0
              ? t('components.shell.workspacesApp.empty')
              : t('components.shell.workspacesApp.noResults')}
          </div>
        ) : (
          <ResourceGrid>
            {filtered.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                tagsById={tagsById}
                onOpen={() => navigate(`/w/${ws.id}`)}
              />
            ))}
          </ResourceGrid>
        )}
      </div>
    </div>
  )
}

function WorkspaceCard({
  ws,
  tagsById,
  onOpen,
}: {
  ws: WsCardData
  tagsById: Map<string, Tag>
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const running = ws.status === 'running'
  const needsReply = ws.active_human_sessions > 0

  const sessionWord =
    ws.active_agent_sessions === 1
      ? t('components.shell.workspacesApp.sessionCount_one', { count: 1 })
      : t('components.shell.workspacesApp.sessionCount_other', {
          count: ws.active_agent_sessions,
        })

  const wsTags = (ws.tag_ids ?? [])
    .map((id) => tagsById.get(id))
    .filter((x): x is Tag => Boolean(x))

  return (
    <ResourceCard
      name={
        <span className="flex items-center gap-2">
          <span
            className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${
              running ? 'bg-success' : 'bg-muted-foreground/30'
            }`}
            aria-hidden
          />
          <span className="min-w-0 truncate">{ws.name}</span>
          {needsReply && (
            <span
              className="ml-auto inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning"
              aria-label="Needs reply"
            />
          )}
        </span>
      }
      body={
        wsTags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {wsTags.map((tag) => {
              const color = getTagColor(tag.color)
              return (
                <span
                  key={tag.id}
                  className={cn(
                    'rounded-full px-1.5 py-0 text-mini font-medium',
                    color.text,
                    'bg-foreground/[0.05]',
                  )}
                >
                  {tag.name}
                </span>
              )
            })}
          </div>
        ) : undefined
      }
      type={ws.active_agent_sessions > 0 ? sessionWord : undefined}
      onClick={onOpen}
    />
  )
}
