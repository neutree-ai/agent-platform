/**
 * Minimal host event bus — exposed as `window.tos.events`. Plugins use this
 * for cross-plugin signals that don't deserve a dedicated API on the host
 * surface, and the host itself uses it to broadcast state changes that
 * plugins may want to react to (e.g. `lang.change` when the host language
 * toggles).
 */

type Listener = (payload?: unknown) => void

const listeners = new Map<string, Set<Listener>>()

function on(event: string, listener: Listener): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(listener)
  return () => set.delete(listener)
}

function emit(event: string, payload?: unknown): void {
  const set = listeners.get(event)
  if (!set) return
  for (const fn of set) {
    try {
      fn(payload)
    } catch (err) {
      console.error(`[host-events] listener for ${event} threw`, err)
    }
  }
}

export const events = { on, emit }
