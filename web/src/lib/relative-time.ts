// Locale-aware compact relative time + full timestamp. Used on file lists,
// shares, memory stores, library cards — anywhere we show a "last updated"
// hint with a hover tooltip carrying the absolute time.

function toMs(input: string | number): number | null {
  const ms = typeof input === 'number' ? input : Date.parse(input)
  return Number.isNaN(ms) || !ms ? null : ms
}

export function formatRelativeTime(input: string | number, locale: string): string {
  const ms = toMs(input)
  if (ms === null) return ''
  const diffSec = Math.round((ms - Date.now()) / 1000)
  const absSec = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (absSec < 60) return rtf.format(diffSec, 'second')
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (absSec < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), 'day')
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export function formatFullTime(input: string | number, locale: string): string {
  const ms = toMs(input)
  if (ms === null) return ''
  return new Date(ms).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
