import { useEffect } from 'react'

const APP_NAME = 'NAP'

type TitlePart = string | null | undefined | false

/**
 * Drives `document.title` from page-level context, restoring the previous
 * title on unmount or when the parts change. Parts are joined by ` · ` and
 * suffixed with the app name, e.g. `useDocumentTitle('My Workspace')` →
 * `My Workspace · NAP`.
 *
 * Falsy parts are dropped, so callers can pass values that are still
 * loading. When nothing resolves to a non-empty string the title is left
 * untouched (no flash of a bare `NAP`).
 */
export function useDocumentTitle(parts: TitlePart | TitlePart[]): void {
  const segments = (Array.isArray(parts) ? parts : [parts]).filter(Boolean) as string[]
  const title = segments.length ? `${segments.join(' · ')} · ${APP_NAME}` : null

  useEffect(() => {
    if (!title) return
    const prev = document.title
    document.title = title
    return () => {
      document.title = prev
    }
  }, [title])
}
