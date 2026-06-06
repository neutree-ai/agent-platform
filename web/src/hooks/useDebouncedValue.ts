import { useEffect, useState } from 'react'

/**
 * Returns `value` after it has been stable for at least `delayMs`. Used to
 * defer expensive work (e.g. server-side search) until the user pauses
 * typing. Setting `delayMs` to 0 makes this a pass-through.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
