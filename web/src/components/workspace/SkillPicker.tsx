import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useSkills } from '@/hooks/useSkills'
import type { ApiSkill } from '@/lib/api/types'
import { Check, GitBranch, Pencil, Plus, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SkillPickerProps {
  /** Selected skill UUIDs (p3 — was names pre-p3). */
  value: string[]
  /** Callback receives the next list of selected skill UUIDs. */
  onChange: (ids: string[]) => void
  /** Template baseline (UUIDs). Set when this picker is inheriting from a template. */
  templateSkills?: string[] | null
}

export function SkillPicker({ value, onChange, templateSkills }: SkillPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Server-side text search, matching the library page. cmdk's built-in
  // client filter is disabled below (`shouldFilter={false}`) — the server is
  // the source of truth so results stay consistent across surfaces.
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  // Share the react-query cache with SkillsSection so the picker doesn't drift
  // out of sync after the user (or someone else) grants/revokes access while
  // the dialog is open. Plain useEffect+useState would freeze on first fetch.
  const { data: allSkills = [], isLoading, isFetching } = useSkills({ q: debouncedSearch })
  const hasQuery = debouncedSearch.trim().length > 0

  const selected = useMemo(() => new Set(value), [value])
  const tplSet = templateSkills ? new Set(templateSkills) : null
  const isDifferentFromTemplate = tplSet
    ? selected.size !== tplSet.size || [...tplSet].some((n) => !selected.has(n))
    : false

  // Sticky cache of fully-loaded skill data accumulated across queries. Once
  // server search shipped, `allSkills` is the *filtered* result, so a
  // selected skill outside the current search would otherwise degrade to
  // a stub row (no description, no owner badge) the moment the user types.
  // We merge each fresh result into the cache so already-seen rows survive.
  // Keyed by id (p3); pre-p3 we keyed by name.
  const [skillCache, setSkillCache] = useState<Map<string, ApiSkill>>(() => new Map())
  useEffect(() => {
    if (allSkills.length === 0) return
    setSkillCache((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const s of allSkills) {
        if (next.get(s.id) !== s) {
          next.set(s.id, s)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allSkills])

  // Selected chips reflect live `value`; if an id has never been loaded
  // (initial render before any listSkills resolves), fall back to a stub so
  // chips still show — the cache will fill in once data arrives. We use the
  // id as the displayed name in that case (better than blank).
  const selectedSkills = useMemo<ApiSkill[]>(
    () =>
      value.map(
        (id) =>
          skillCache.get(id) ?? {
            id,
            source_id: '',
            source_kind: 'native' as const,
            active_version_id: null,
            name: id,
            subpath: '',
            description: '',
            user_id: '',
            is_public: false,
            visibility: 'private' as const,
            my_permission: 'public' as const,
            shared_via_teams: [],
            owner_name: '',
            is_own: false,
            category: null,
            created_at: '',
            updated_at: '',
          },
      ),
    [value, skillCache],
  )

  // Within-group order: selected-first then alphabetical (by name). Selected
  // ordering is frozen per popover-open so toggling doesn't shuffle rows
  // under the cursor. Re-syncs ONLY on the open transition — putting `value`
  // in deps would re-freeze after every toggle (defeating the freeze), and
  // worse, would wipe `search` mid-typing whenever the parent re-renders
  // with a new array reference, which feels like the input losing focus.
  const [frozenSelected, setFrozenSelected] = useState<Set<string>>(selected)
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment
  useEffect(() => {
    if (!open) return
    setFrozenSelected(new Set(value))
    setSearch('')
  }, [open])

  // Three buckets — matches the prompt picker pattern:
  // - yours: I own it (any visibility)
  // - sharedWithMe: someone else's, granted to a team I'm in
  // - public: someone else's, visibility=public, no team grant in play
  const { yours, sharedWithMe, public_ } = useMemo(() => {
    const sortFn = (a: ApiSkill, b: ApiSkill) => {
      const aSel = frozenSelected.has(a.id) ? 0 : 1
      const bSel = frozenSelected.has(b.id) ? 0 : 1
      if (aSel !== bSel) return aSel - bSel
      return a.name.localeCompare(b.name)
    }
    const yours: ApiSkill[] = []
    const sharedWithMe: ApiSkill[] = []
    const public_: ApiSkill[] = []
    for (const s of allSkills) {
      if (s.is_own) yours.push(s)
      else if (s.shared_via_teams.length > 0) sharedWithMe.push(s)
      else public_.push(s)
    }
    yours.sort(sortFn)
    sharedWithMe.sort(sortFn)
    public_.sort(sortFn)
    return { yours, sharedWithMe, public_ }
  }, [allSkills, frozenSelected])

  function toggle(id: string) {
    if (selected.has(id)) onChange(value.filter((n) => n !== id))
    else onChange([...value, id])
  }

  function revertToTemplate() {
    if (templateSkills) onChange([...templateSkills])
  }

  function renderItem(skill: ApiSkill) {
    const isSel = selected.has(skill.id)
    const isFromTemplate = tplSet?.has(skill.id) ?? false
    // Disambiguates same-named skills owned by different people, and shows
    // which team a shared skill came in via — important now that the picker
    // surfaces team-shared skills under "Shared with me".
    const sourceParts: string[] = []
    if (!skill.is_own && skill.owner_name) sourceParts.push(`@${skill.owner_name}`)
    if (skill.shared_via_teams.length > 0) {
      sourceParts.push(skill.shared_via_teams.map((tm) => tm.name).join(', '))
    }
    const sourceLine = sourceParts.join(' · ')
    return (
      <CommandItem
        key={skill.id}
        // cmdk uses `value` for its match keys. Combine name + id so search
        // matches by name (the human-visible string) but ids stay unique
        // across the list (two users can each own a skill called "design").
        value={`${skill.name} ${skill.id}`}
        keywords={skill.description ? [skill.description] : undefined}
        onSelect={() => toggle(skill.id)}
        className="items-start gap-2 py-1.5"
      >
        <div className="flex h-4 w-4 shrink-0 items-center justify-center mt-0.5">
          {isSel && <Check className="h-3.5 w-3.5 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <span className="truncate">{skill.name}</span>
            {isFromTemplate && (
              <Badge
                variant="outline"
                className="h-4 px-1 text-micro shrink-0 border-success/30 bg-success/10 text-success"
              >
                {t('components.skillPicker.badges.template')}
              </Badge>
            )}
          </div>
          {sourceLine && <div className="text-micro text-muted-foreground/60">{sourceLine}</div>}
          {skill.description && (
            <div className="text-tiny text-muted-foreground/70 line-clamp-2">
              {skill.description}
            </div>
          )}
        </div>
      </CommandItem>
    )
  }

  return (
    <div className="space-y-2">
      {tplSet &&
        (isDifferentFromTemplate ? (
          <Badge
            variant="outline"
            className="h-5 gap-1 px-1.5 text-mini border-warning/30 bg-warning/10 text-warning cursor-pointer"
            onClick={revertToTemplate}
          >
            <Pencil className="h-3 w-3" />
            {t('components.agentConfigFieldHint.overridden')}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="h-5 gap-1 px-1.5 text-mini border-success/30 bg-success/10 text-success cursor-default"
          >
            <GitBranch className="h-3 w-3" />
            {t('components.agentConfigFieldHint.inherited')}
          </Badge>
        ))}

      <div className="space-y-1.5">
        {selectedSkills.map((skill) => (
          <div
            key={skill.id}
            className="group/skill relative flex items-start gap-2 rounded-lg bg-foreground/[0.04] px-3 py-2"
          >
            <Wrench
              className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{skill.name}</span>
                {tplSet?.has(skill.id) && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-micro shrink-0 border-success/30 bg-success/10 text-success"
                  >
                    {t('components.skillPicker.badges.template')}
                  </Badge>
                )}
                {skill.is_own && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-micro shrink-0 border-primary/30 bg-primary/10 text-primary"
                  >
                    {t('components.skillPicker.badges.yours')}
                  </Badge>
                )}
              </div>
              {skill.description && (
                <div className="text-tiny text-muted-foreground/70 line-clamp-2 leading-relaxed">
                  {skill.description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggle(skill.id)}
              className="shrink-0 rounded-sm p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover/skill:opacity-100 focus:opacity-100"
              aria-label={t('components.skillPicker.actions.remove', { name: skill.name })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-center gap-1.5 border-dashed text-xs font-normal text-muted-foreground"
              disabled={isLoading}
            >
              <Plus className="h-3 w-3" />
              {t('components.skillPicker.actions.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={8}
            className="w-[--radix-popover-trigger-width] min-w-[360px] max-h-[--radix-popover-content-available-height] p-0 flex flex-col overflow-hidden"
            onOpenAutoFocus={(e) => {
              // Let CommandInput grab focus, not the content root.
              e.preventDefault()
            }}
          >
            {/* shouldFilter={false}: server already filtered via `q`, so cmdk
                must not also strip rows by its own fuzzy match — that would
                double-filter and hide valid results. Command + CommandInput
                stay mounted across fetches; only the list body swaps between
                spinner / empty state / bucketed rows so the user can keep
                typing during refetches. */}
            <Command className="flex min-h-0 flex-1 flex-col" shouldFilter={false}>
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder={t('components.skillPicker.placeholders.search')}
                className="h-9 text-xs"
              />
              <CommandList className="min-h-0 flex-1 max-h-none">
                {(isLoading || (isFetching && allSkills.length === 0)) && (
                  <div className="flex items-center justify-center py-6">
                    <Spinner size="sm" />
                  </div>
                )}
                {!isLoading && !isFetching && allSkills.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground/60">
                    {hasQuery
                      ? t('components.skillPicker.empty.noResults')
                      : t('components.skillPicker.empty.noSkills')}
                  </div>
                )}
                {yours.length > 0 && (
                  <CommandGroup heading={t('components.skillPicker.groups.yours')}>
                    {yours.map(renderItem)}
                  </CommandGroup>
                )}
                {sharedWithMe.length > 0 && (
                  <CommandGroup heading={t('components.skillPicker.groups.shared')}>
                    {sharedWithMe.map(renderItem)}
                  </CommandGroup>
                )}
                {public_.length > 0 && (
                  <CommandGroup heading={t('components.skillPicker.groups.public')}>
                    {public_.map(renderItem)}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
