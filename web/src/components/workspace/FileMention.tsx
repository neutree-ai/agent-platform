import { dirListUrl } from '@/lib/api/agent-files'
import { isCommitEnter } from '@/lib/keyboard'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { File as FileIcon, Folder } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type DufsEntry, isDir } from './file-operations'

const FILE_MENTION_PREFIX = '@file/'

/**
 * Extract `@file/<path>` fragment ending at cursor.
 *
 * The path may contain spaces — workspace files/folders are routinely named
 * with them (e.g. "Q3 incident notes"). Only `@` (the start of another mention) and
 * newlines terminate the fragment.
 */
export function getFileMention(
  input: string,
  cursorPos: number,
): { path: string; start: number; end: number } | null {
  const before = input.slice(0, cursorPos)
  const match = before.match(/@file\/([^@\n]*)$/)
  if (!match) return null
  return {
    path: match[1],
    start: before.length - match[0].length,
    end: cursorPos,
  }
}

function splitPath(path: string): { dir: string; query: string } {
  const i = path.lastIndexOf('/')
  if (i === -1) return { dir: '', query: path }
  return { dir: path.slice(0, i), query: path.slice(i + 1) }
}

function FileMentionMenu({
  workspaceId,
  input,
  cursorPos,
  onSelect,
  onDismiss,
  visible,
  anchorRef,
  onActiveChange,
}: {
  workspaceId: string
  input: string
  cursorPos: number
  onSelect: (entry: DufsEntry, dir: string) => void
  onDismiss: () => void
  visible: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onActiveChange: (active: boolean) => void
}) {
  const [highlightIndex, setHighlightIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const mention = visible ? getFileMention(input, cursorPos) : null
  const { dir, query } = splitPath(mention?.path ?? '')

  // Debounce the query before it drives the backend search so fast typing
  // doesn't fire a request per keystroke. An empty query (e.g. right after
  // drilling into a folder) takes effect immediately.
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  useEffect(() => {
    if (query === '') {
      setDebouncedQuery('')
      return
    }
    const t = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(t)
  }, [query])

  const { data: entries } = useQuery({
    queryKey: ['file-mention-dir', workspaceId, dir, debouncedQuery],
    queryFn: async (): Promise<DufsEntry[]> => {
      // A non-empty query switches the backend into recursive search within
      // `dir`, so `@file/` can reach deeply nested files — not just one level.
      const resp = await fetch(dirListUrl(workspaceId, dir || '/', debouncedQuery || undefined))
      if (!resp.ok) return []
      const json = await resp.json()
      return (json.entries ?? []) as DufsEntry[]
    },
    enabled: visible,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })

  const q = query.toLowerCase()
  const filtered = (entries ?? [])
    .filter((e) => e.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aD = isDir(a) ? 0 : 1
      const bD = isDir(b) ? 0 : 1
      if (aD !== bD) return aD - bD
      return a.name.localeCompare(b.name)
    })
    .slice(0, 50)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
  useEffect(() => {
    setHighlightIndex(0)
  }, [dir, query])

  // Keep the highlighted row visible when navigating a scrolled list with the
  // keyboard. `block: 'nearest'` is a no-op when the row is already on screen,
  // so mouse hover (which also moves the highlight) won't cause jitter.
  useEffect(() => {
    const row = listRef.current?.children[highlightIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  const active = visible && !!mention && filtered.length > 0
  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])

  if (!active) return null

  return (
    <>
      <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden">
        <div className="border-b border-border px-2 py-1 text-mini text-muted-foreground">
          {FILE_MENTION_PREFIX}
          {dir ? `${dir}/` : ''}
        </div>
        <div ref={listRef} className="max-h-48 overflow-y-auto p-1">
          {filtered.map((entry, i) => (
            <button
              type="button"
              key={entry.name}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left ${
                i === highlightIndex ? 'bg-accent' : 'hover:bg-accent'
              }`}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(entry, dir)
              }}
            >
              {isDir(entry) ? (
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="text-xs font-mono truncate">
                {entry.name}
                {isDir(entry) ? '/' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
      <FileMentionKeyHandler
        highlightIndex={highlightIndex}
        setHighlightIndex={setHighlightIndex}
        filtered={filtered}
        dir={dir}
        onSelect={onSelect}
        onDismiss={onDismiss}
        anchorRef={anchorRef}
      />
    </>
  )
}

function FileMentionKeyHandler({
  highlightIndex,
  setHighlightIndex,
  filtered,
  dir,
  onSelect,
  onDismiss,
  anchorRef,
}: {
  highlightIndex: number
  setHighlightIndex: (i: number) => void
  filtered: DufsEntry[]
  dir: string
  onSelect: (entry: DufsEntry, dir: string) => void
  onDismiss: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'ArrowUp') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex <= 0 ? filtered.length - 1 : highlightIndex - 1)
      } else if (ke.key === 'ArrowDown') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex >= filtered.length - 1 ? 0 : highlightIndex + 1)
      } else if ((isCommitEnter(ke) || ke.key === 'Tab') && !ke.ctrlKey && !ke.metaKey) {
        ke.preventDefault()
        if (filtered[highlightIndex]) onSelect(filtered[highlightIndex], dir)
      } else if (ke.key === 'Escape') {
        ke.preventDefault()
        onDismiss()
      }
    }
    el.addEventListener('keydown', handler, true)
    return () => el.removeEventListener('keydown', handler, true)
  }, [highlightIndex, filtered, dir, onSelect, onDismiss, setHighlightIndex, anchorRef])
  return null
}

export function useFileMention({
  workspaceId,
  input,
  setInput,
  inputRef,
}: {
  workspaceId: string
  input: string
  setInput: (v: string) => void
  inputRef: React.RefObject<HTMLElement | null>
}) {
  const [visible, setVisible] = useState(false)
  const [active, setActive] = useState(false)
  const cursorPosRef = useRef(0)
  const pendingCursorRef = useRef<number | null>(null)

  const hasTrigger = input.includes(FILE_MENTION_PREFIX)

  // After a programmatic insertion, sync the textarea cursor before the
  // dependent useEffect reads selectionStart — otherwise React's preserved
  // selection or default end-of-value would feed a stale cursor into
  // getFileMention and the dir list wouldn't relist.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire on input commit
  useLayoutEffect(() => {
    if (pendingCursorRef.current === null) return
    const el = inputRef.current as HTMLTextAreaElement | null
    const pos = pendingCursorRef.current
    pendingCursorRef.current = null
    cursorPosRef.current = pos
    if (el) {
      el.focus()
      el.setSelectionRange(pos, pos)
    }
  }, [input, inputRef])

  useEffect(() => {
    if (!hasTrigger) {
      setVisible(false)
      return
    }
    const el = inputRef.current as HTMLTextAreaElement | null
    if (el) cursorPosRef.current = el.selectionStart ?? 0
    setVisible(!!getFileMention(input, cursorPosRef.current))
  }, [input, hasTrigger, inputRef])

  const handleSelect = (entry: DufsEntry, dir: string) => {
    const el = inputRef.current as HTMLTextAreaElement | null
    if (el) cursorPosRef.current = el.selectionStart ?? 0
    const mention = getFileMention(input, cursorPosRef.current)
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(mention.end)
    const dirPrefix = dir ? `${dir}/` : ''
    const entryIsDir = isDir(entry)
    const inserted = entryIsDir
      ? `${FILE_MENTION_PREFIX}${dirPrefix}${entry.name}/`
      : `${FILE_MENTION_PREFIX}${dirPrefix}${entry.name} `
    const newCursorPos = mention.start + inserted.length
    cursorPosRef.current = newCursorPos
    pendingCursorRef.current = newCursorPos
    setInput(before + inserted + after)
    if (!entryIsDir) setVisible(false)
  }

  const menu = (
    <FileMentionMenu
      workspaceId={workspaceId}
      input={input}
      cursorPos={cursorPosRef.current}
      onSelect={handleSelect}
      onDismiss={() => setVisible(false)}
      visible={visible}
      anchorRef={inputRef}
      onActiveChange={setActive}
    />
  )

  return { fileMentionVisible: active, fileMentionMenu: menu }
}
