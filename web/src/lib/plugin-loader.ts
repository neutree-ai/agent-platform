/**
 * External plugin loader. Two modes per manifest entry:
 *
 *  - **eager** (default): inject the bundle as an ordered IIFE `<script>`
 *    during boot. Same behaviour the loader had since day one — keeps
 *    backwards-compat for plugins that don't declare `lazy`.
 *
 *  - **lazy**: skip script injection at boot. Register the plugin's
 *    declared surfaces (panels / tool renderers / tool handlers) as
 *    placeholders so the host can show stub UI and trigger
 *    `ensurePluginLoaded(pluginId)` on first interaction with any of
 *    them. Each surface independently kicks off the load — panel click,
 *    chat rendering a matching tool call, or a tool result event
 *    matching a handler pattern.
 *
 * Failures are logged but never block boot: a missing or broken plugin
 * must not take the app offline.
 */

import {
  registerLazyPanel,
  registerLazyToolHandler,
  registerLazyToolRenderer,
} from './plugin-lazy-registry'

interface PluginOwnsManifest {
  panels?: { id: string; label: string }[]
  toolRenderers?: string[]
  toolHandlers?: { id: string; pattern: string }[]
}

interface PluginManifestEntry {
  id: string
  version: string
  bundleUrl: string
  /** Defaults to false (eager) when absent — preserves old behaviour. */
  lazy?: boolean
  /** Required when `lazy` is true. Declares which surfaces trigger the
   *  on-demand load. */
  owns?: PluginOwnsManifest | null
}

/**
 * Fetches the cp-published manifest. Returns the entry array on success
 * (possibly empty when no plugins are enabled), or `null` when the fetch
 * couldn't authenticate / failed transiently. The `null` case matters:
 * `/api/plugins` requires a session, and boot runs before auth, so a
 * first-of-day load with an expired cookie 401s here. Returning `null`
 * (vs `[]`) lets `loadExternalPlugins` avoid caching an empty result and
 * retry once the user authenticates — otherwise plugin apps stay missing
 * until a full page reload.
 */
async function fetchManifest(): Promise<PluginManifestEntry[] | null> {
  try {
    const res = await fetch('/api/plugins', { credentials: 'include' })
    if (!res.ok) {
      // 404 = endpoint/manifest genuinely absent → treat as empty (final).
      // Everything else (401/403/5xx) is a retryable failure → null.
      if (res.status === 404) return []
      console.warn(`[plugins] manifest fetch returned ${res.status}`)
      return null
    }
    const body = (await res.json()) as PluginManifestEntry[]
    return Array.isArray(body) ? body : []
  } catch (err) {
    console.warn('[plugins] manifest fetch failed', err)
    return null
  }
}

/**
 * Dev-only: when the host vite server has NAP_DEV_PLUGINS_DIR set, it
 * serves a local manifest at /dev-plugins/manifest.json scanned from disk.
 * Local entries override (or augment) the cp-published manifest by id.
 */
async function fetchDevManifest(): Promise<PluginManifestEntry[]> {
  if (!import.meta.env.DEV) return []
  try {
    const res = await fetch('/dev-plugins/manifest.json', { cache: 'no-cache' })
    if (!res.ok) return []
    const body = (await res.json()) as PluginManifestEntry[]
    return Array.isArray(body) ? body : []
  } catch {
    return []
  }
}

function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = url
    el.async = false
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`failed to load: ${url}`))
    document.head.appendChild(el)
  })
}

/** Memoized per-plugin loader: multiple surfaces calling
 *  `ensurePluginLoaded` for the same plugin share one inject. */
const pendingLoads = new Map<string, Promise<void>>()
const loaded = new Set<string>()
const bundleUrlById = new Map<string, string>()

export function ensurePluginLoaded(pluginId: string): Promise<void> {
  if (loaded.has(pluginId)) return Promise.resolve()
  const existing = pendingLoads.get(pluginId)
  if (existing) return existing
  const url = bundleUrlById.get(pluginId)
  if (!url) {
    // Unknown plugin id or not a lazy entry; nothing to do.
    return Promise.resolve()
  }
  const p = injectScript(url)
    .then(() => {
      loaded.add(pluginId)
      pendingLoads.delete(pluginId)
      console.info(`[plugins] lazy-loaded ${pluginId}`)
    })
    .catch((err) => {
      pendingLoads.delete(pluginId)
      console.error(`[plugins] failed to lazy-load ${pluginId}`, err)
      throw err
    })
  pendingLoads.set(pluginId, p)
  return p
}

// Boot runs `loadExternalPlugins` before auth (main.tsx), so its manifest
// fetch can 401 on a first-of-day load with an expired cookie. We therefore
// keep this callable again after the user authenticates (AuthProvider). These
// guards make re-invocation safe and cheap:
//  - `manifestLoaded` flips true only once a manifest actually resolved, so a
//    successful boot load makes the post-auth call a no-op.
//  - `inflight` dedupes overlapping calls (boot + auth effect racing).
let manifestLoaded = false
let inflight: Promise<void> | null = null

export function loadExternalPlugins(): Promise<void> {
  if (manifestLoaded) return Promise.resolve()
  if (inflight) return inflight
  inflight = doLoadExternalPlugins().finally(() => {
    inflight = null
  })
  return inflight
}

async function doLoadExternalPlugins(): Promise<void> {
  const [published, dev] = await Promise.all([fetchManifest(), fetchDevManifest()])
  // Manifest fetch failed to authenticate and no dev override to fall back on:
  // leave `manifestLoaded` false so the post-auth retry re-fetches. Caching an
  // empty list here is exactly the bug that hid plugin apps until reload.
  if (published === null && dev.length === 0) return
  const byId = new Map<string, PluginManifestEntry>()
  for (const e of published ?? []) byId.set(e.id, e)
  for (const e of dev) byId.set(e.id, e) // dev wins on conflict; new ids added
  if (dev.length > 0) {
    console.info(`[plugins] dev override active: ${dev.map((e) => e.id).join(', ')}`)
  }
  for (const entry of byId.values()) {
    bundleUrlById.set(entry.id, entry.bundleUrl)
    if (entry.lazy) {
      registerLazyDescriptors(entry)
    } else if (!loaded.has(entry.id)) {
      // Guard against double-injection when this runs a second time post-auth.
      try {
        await injectScript(entry.bundleUrl)
        loaded.add(entry.id)
        console.info(`[plugins] loaded ${entry.id}@${entry.version}`)
      } catch (err) {
        console.error(`[plugins] failed to load ${entry.id}`, err)
      }
    }
  }
  manifestLoaded = true
}

function registerLazyDescriptors(entry: PluginManifestEntry): void {
  const owns = entry.owns
  if (!owns) {
    console.warn(`[plugins] lazy plugin ${entry.id} has no \`owns\` declaration; cannot trigger`)
    return
  }
  for (const panel of owns.panels ?? []) {
    registerLazyPanel(panel.id, { pluginId: entry.id, label: panel.label })
  }
  for (const toolName of owns.toolRenderers ?? []) {
    registerLazyToolRenderer(toolName, entry.id)
  }
  for (const handler of owns.toolHandlers ?? []) {
    try {
      registerLazyToolHandler(new RegExp(handler.pattern, 'i'), entry.id)
    } catch (err) {
      console.warn(
        `[plugins] lazy plugin ${entry.id} has invalid handler pattern ${handler.id}:`,
        err,
      )
    }
  }
  console.info(
    `[plugins] registered lazy ${entry.id}@${entry.version} (panels=${owns.panels?.length ?? 0}, renderers=${owns.toolRenderers?.length ?? 0}, handlers=${owns.toolHandlers?.length ?? 0})`,
  )
}
