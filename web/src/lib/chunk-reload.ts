/**
 * Recovery for stale dynamic-import chunks after a frontend deploy.
 *
 * Vite splits the app into content-hashed chunks; panels are loaded via
 * `lazy(() => import(...))`. A deploy rotates every chunk hash and removes
 * the old files. A browser still showing a pre-deploy page will, on the next
 * panel switch, dynamically import a chunk whose hash no longer exists —
 * the request 404s and the import rejects, white-screening the app.
 *
 * `installChunkReload()` listens for Vite's `vite:preloadError` event (fired
 * by the `__vitePreload` helper that wraps every dynamic import) and reloads
 * the page once, which re-fetches the no-cache `index.html` and picks up the
 * current chunk hashes. `isChunkLoadError()` lets an error boundary recognise
 * the same failure as a last-resort fallback when the reload is suppressed.
 */

const RELOAD_GUARD_KEY = 'tos:chunk-reload-at'
// If a reload was attempted within this window, don't reload again — a second
// failure means the new bundle is genuinely broken (or offline), not stale.
// In that case we let the error surface to the boundary instead of looping.
const RELOAD_GUARD_MS = 10_000

/** True for the various "dynamic import failed" messages across browsers. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /'text\/html'/i.test(message)
  )
}

/** Reload once to pick up fresh chunk hashes; returns false if guard-blocked. */
export function reloadForStaleChunks(): boolean {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0)
  } catch {
    // sessionStorage can throw in private mode / sandboxed iframes — fall
    // through and reload anyway; a one-off loop is better than a white screen.
  }
  if (Date.now() - last < RELOAD_GUARD_MS) return false
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // ignore — see above
  }
  window.location.reload()
  return true
}

export function installChunkReload(): void {
  // `vite:preloadError` is not in the lib DOM types; it carries the failing
  // import's reason on `.payload`. We don't call preventDefault(), so Vite
  // still rethrows the rejection into the lazy() boundary as a safety net.
  window.addEventListener('vite:preloadError', () => {
    reloadForStaleChunks()
  })
}
