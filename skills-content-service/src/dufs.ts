/**
 * Local dufs sidecar.
 *
 * dufs is a static-file server with WebDAV + JSON listing + zip archive — the
 * same one the agent pods run. We launch one locally, scoped to `CACHE_DIR`
 * and bound to loopback, and proxy version-resolved URLs to it. This keeps
 * the fs API contract identical to the workspace file browser.
 *
 * Read-only mode: no `--allow-upload` / `--allow-delete`. We pass
 * `--allow-archive` (zip download) and `--allow-search` (recursive `?q=`
 * search) since the UI's existing file browser uses both.
 *
 * Restart on exit so a dufs crash doesn't take the whole pod down. Failed
 * proxies during the brief gap will surface as 502 to callers.
 */
import { spawn } from 'node:child_process'

const CACHE_DIR = process.env.CACHE_DIR || '/var/cache/skills-content'
const DUFS_PORT = Number(process.env.DUFS_PORT || 5000)

export const DUFS_ORIGIN = `http://127.0.0.1:${DUFS_PORT}`

export function startDufs() {
  const launch = () => {
    const child = spawn(
      'dufs',
      [
        CACHE_DIR,
        '--bind',
        '127.0.0.1',
        '--port',
        String(DUFS_PORT),
        '--allow-archive',
        '--allow-search',
        '--allow-symlink',
      ],
      { stdio: 'inherit' },
    )
    child.on('error', (err) => {
      console.error('[skills-content] failed to spawn dufs:', err.message)
    })
    child.on('exit', (code) => {
      console.warn(`[skills-content] dufs exited with code ${code}, restarting in 2s`)
      setTimeout(launch, 2000)
    })
  }
  launch()
}
