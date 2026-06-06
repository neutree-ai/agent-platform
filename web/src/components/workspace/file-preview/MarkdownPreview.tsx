import { Markdown } from '@/components/ui/markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useMarkdownPreferencesStore } from '@/stores/markdown-preferences-store'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import rehypeSlug from 'rehype-slug'
import { defaultRehypePlugins } from 'streamdown'
import type { PluggableList } from 'unified'

// Streamdown's `rehypePlugins` prop replaces its whole pipeline rather than
// extending it. Passing just `[rehypeSlug]` would drop rehype-raw (inline
// HTML), sanitize and harden — so `<table>` and other embedded HTML silently
// vanish from the preview. Layer slug on top of the defaults instead; sanitize
// stays in place, so this is still XSS-safe.
// Hoisted so the memoized Markdown sees a stable reference; otherwise a new
// array every render busts the memo.
const REHYPE_PLUGINS: PluggableList = [...Object.values(defaultRehypePlugins), rehypeSlug]

interface TocItem {
  id: string
  text: string
  level: 1 | 2 | 3
}

/**
 * Walk the rendered output rather than re-parsing the source — guarantees
 * ids match what rehype-slug actually emitted and that text reflects inline
 * markup (links, code, emphasis) the way the user sees it.
 */
function readTocFromDom(root: HTMLElement): TocItem[] {
  const out: TocItem[] = []
  for (const el of root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3')) {
    if (!el.id) continue
    const text = (el.textContent ?? '').trim()
    if (!text) continue
    const level = Number(el.tagName.slice(1)) as 1 | 2 | 3
    out.push({ id: el.id, text, level })
  }
  return out
}

export function MarkdownPreview({ content }: { content: string }) {
  const { t } = useTranslation()
  const tocVisible = useMarkdownPreferencesStore((s) => s.tocVisible)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const scrollRootRef = useRef<HTMLDivElement | null>(null)

  const getViewport = (): HTMLElement | null =>
    scrollRootRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]') ?? null

  // Re-scan after the Markdown subtree paints. Static mode means one paint
  // per content change; rAF defers past the same-frame commit so heading ids
  // (added by rehype-slug) are in the DOM when we look.
  useEffect(() => {
    if (!tocVisible) return
    const root = getViewport()
    if (!root) return
    const handle = requestAnimationFrame(() => {
      setToc(readTocFromDom(root))
    })
    return () => cancelAnimationFrame(handle)
  }, [tocVisible, content])

  // Scrollspy: Radix ScrollArea uses an inner viewport; the document never
  // scrolls, so IntersectionObserver must use that viewport as `root`.
  useEffect(() => {
    if (!tocVisible || toc.length === 0) return
    const root = getViewport()
    if (!root) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    for (const item of toc) {
      const el = root.querySelector(`#${CSS.escape(item.id)}`)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [tocVisible, toc])

  const scrollTo = (id: string) => {
    const root = getViewport()
    if (!root) return
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!el) return
    root.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
    setActiveId(id)
    setMobileOpen(false)
  }

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {tocVisible && (
        <div className="@[520px]:hidden border-b border-border/60">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
          >
            <span>{t('components.filePreview.toc.label')}</span>
            <ChevronDown
              className={cn('size-3.5 transition-transform', mobileOpen && 'rotate-180')}
            />
          </button>
          {mobileOpen && (
            <div className="max-h-48 overflow-y-auto px-3 pb-2">
              {toc.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">
                  {t('components.filePreview.toc.empty')}
                </p>
              ) : (
                <TocList toc={toc} activeId={activeId} onSelect={scrollTo} />
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {tocVisible && (
          <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 @[520px]:flex">
            <ScrollArea className="flex-1">
              <div className="p-3">
                {toc.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('components.filePreview.toc.empty')}
                  </p>
                ) : (
                  <TocList toc={toc} activeId={activeId} onSelect={scrollTo} />
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
        <ScrollArea ref={scrollRootRef} className="flex-1">
          <div className="p-4">
            <Markdown rehypePlugins={REHYPE_PLUGINS}>{content}</Markdown>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function TocList({
  toc,
  activeId,
  onSelect,
}: {
  toc: TocItem[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-0.5">
      {toc.map((item, idx) => (
        <li key={`${item.id}-${idx}`}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              'block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors',
              'hover:bg-muted/60',
              item.level === 2 && 'pl-4',
              item.level === 3 && 'pl-6',
              activeId === item.id
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground',
            )}
            title={item.text}
          >
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  )
}
