import { useCallback, useState } from 'react'

// Expand/collapse choices the reader made in a transcript, kept for the life of
// the page. A virtualized host unmounts messages as they scroll out of view, so
// the choice can't live in component state alone.
const choices = new Map<string, boolean>()

/** Whether the fold identified by `key` is expanded. Folds start collapsed. */
export function useFoldState(key: string): [boolean, (expanded: boolean) => void] {
  const [expanded, setExpanded] = useState(() => choices.get(key) ?? false)
  const set = useCallback(
    (next: boolean) => {
      choices.set(key, next)
      setExpanded(next)
    },
    [key],
  )
  return [expanded, set]
}
