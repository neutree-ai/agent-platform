import { ChevronDown, ChevronUp } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFoldState } from '../lib/fold-state'

// Content taller than the fold height is clipped to it. The slack keeps a block
// that is only slightly taller whole — folding it would hide less than the
// toggle itself takes up. FOLD_HEIGHT_PX must match the max-h class below.
const FOLD_HEIGHT_PX = 300
const FOLD_SLACK_PX = 80

/**
 * Clips tall content to a fixed height behind a "show more" toggle. The content
 * stays mounted while folded, so it measures and streams as usual.
 */
export function Foldable({
  foldKey,
  disabled = false,
  toggleClassName = 'text-muted-foreground hover:text-foreground',
  children,
}: {
  /** Identifies this fold across unmounts, so the reader's choice survives. */
  foldKey: string
  /** Render the content whole, whatever its height. */
  disabled?: boolean
  toggleClassName?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useFoldState(foldKey)
  const [tall, setTall] = useState(false)
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setTall(el.offsetHeight > FOLD_HEIGHT_PX + FOLD_SLACK_PX)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const foldable = tall && !disabled
  const folded = foldable && !expanded

  const toggle = () => {
    setExpanded(folded)
    // Collapsing from the bottom of a long block would leave the reader far
    // below it; bring the block back into view.
    if (!folded) {
      requestAnimationFrame(() => outerRef.current?.scrollIntoView({ block: 'nearest' }))
    }
  }

  return (
    <div ref={outerRef}>
      <div
        className={
          folded
            ? 'max-h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]'
            : undefined
        }
      >
        <div ref={innerRef}>{children}</div>
      </div>
      {foldable && (
        <button
          type="button"
          className={`mt-1 flex items-center gap-1 text-mini ${toggleClassName}`}
          onClick={toggle}
        >
          {folded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          {folded
            ? t('components.chat.messageBubble.actions.showMore')
            : t('components.chat.messageBubble.actions.showLess')}
        </button>
      )}
    </div>
  )
}
