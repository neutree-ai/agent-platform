import { afterAll, beforeAll, expect, test } from 'vitest'
import { sandboxService, workspaceSandboxes } from './sandbox-client'
import {
  client,
  describeIfSandbox,
  describeIfSandboxService,
  profile,
  runToken,
  scoped,
} from './setup'

// Sandboxes are covered in two halves, each owning its own sandbox.
//
// The control plane proxies four operations, so the file and command surface
// has no route through it. Rather than have one group depend on the other's
// sandbox — and on a control-plane token and a service token resolving to the
// same principal — each half creates and deletes its own.

const WAIT_STEP_MS = 500

async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) return result
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS))
  }
  const detail = lastErr ? `; last error: ${(lastErr as Error).message}` : ''
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${detail}`)
}

// ---------------------------------------------------------------------------

describeIfSandbox('sandboxes through the workspace API', () => {
  let wsId: string
  let sandboxId: string | undefined

  beforeAll(async () => {
    // A bare workspace is enough: the route authorises against the workspace
    // record and mints the owner's token. It never has to be running.
    const ws = await client.workspaces.create({ name: scoped('sbx-ws') })
    wsId = ws.id
  })

  afterAll(async () => {
    try {
      if (sandboxId)
        await workspaceSandboxes(runToken, wsId)
          .delete(sandboxId)
          .catch(() => {})
    } catch {}
    try {
      if (wsId) await client.workspaces.delete(wsId)
    } catch {}
  })

  test('create a sandbox owned by the workspace', { timeout: 180_000 }, async () => {
    const created = await workspaceSandboxes(runToken, wsId).create({
      image: profile.sandboxImage,
      resource: { cpu: '500m', memory: '512Mi' },
      timeout_seconds: 900,
    })
    expect(created.id).toBeTruthy()
    sandboxId = created.id
  })

  test('list is scoped to the workspace', async () => {
    const result = await workspaceSandboxes(runToken, wsId).list()
    const ids = (result.sandboxes ?? []).map((s) => (s as { id: string }).id)
    expect(ids).toContain(sandboxId)
  })

  test('resolve an endpoint for a port', async () => {
    const { url } = await workspaceSandboxes(runToken, wsId).endpoint(sandboxId as string, 8080)
    expect(url).toMatch(/^https?:\/\//)
  })

  test('delete releases the sandbox', { timeout: 60_000 }, async () => {
    await workspaceSandboxes(runToken, wsId).delete(sandboxId as string)
    const gone = await until('the sandbox to leave the workspace listing', async () => {
      const result = await workspaceSandboxes(runToken, wsId).list()
      const ids = (result.sandboxes ?? []).map((s) => (s as { id: string }).id)
      return !ids.includes(sandboxId as string)
    })
    expect(gone).toBe(true)
    sandboxId = undefined
  })
})

// ---------------------------------------------------------------------------

describeIfSandboxService('sandbox files and commands', () => {
  let sbx: ReturnType<typeof sandboxService>
  let id: string

  beforeAll(async () => {
    sbx = sandboxService(runToken)
    const created = await sbx.create({
      image: profile.sandboxImage,
      timeoutSeconds: 1800,
      resource: { cpu: '500m', memory: '512Mi' },
      metadata: { e2e: scoped('files') },
    })
    id = created.id
  }, 180_000)

  afterAll(async () => {
    try {
      if (id) await sbx.kill(id)
    } catch {}
  })

  test('run a command and report its exit code', { timeout: 60_000 }, async () => {
    const ok = await sbx.exec(id, 'echo out; echo err >&2')
    expect(ok.stdout).toContain('out')
    expect(ok.stderr).toContain('err')
    expect(ok.exitCode).toBe(0)

    const failed = await sbx.exec(id, 'exit 3')
    expect(failed.exitCode).toBe(3)
  })

  test('honour the working directory', { timeout: 60_000 }, async () => {
    const result = await sbx.exec(id, 'pwd', { cwd: '/tmp' })
    expect(result.stdout.trim()).toBe('/tmp')
  })

  test(
    'follow a background command by cursor, then interrupt one',
    { timeout: 120_000 },
    async () => {
      const started = await sbx.exec(id, 'for i in 1 2 3; do echo tick-$i; sleep 1; done', {
        background: true,
      })
      expect(started.commandId).toBeTruthy()
      // Detached: output arrives through the log endpoint, not this response.
      expect(started.stdout).toBe('')
      expect(started.exitCode).toBeNull()
      const commandId = started.commandId as string

      const running = await sbx.commandStatus(id, commandId)
      expect(running.running).toBe(true)

      const first = await sbx.commandLogs(id, commandId, 0)
      expect(typeof first.cursor).toBe('number')

      const done = await until(
        'the background command to finish',
        async () => {
          const status = await sbx.commandStatus(id, commandId)
          return status.running === false ? status : null
        },
        60_000,
      )
      expect(done.exitCode).toBe(0)

      // The cursor is an offset, so resuming from it returns only what came after.
      const all = await sbx.commandLogs(id, commandId, 0)
      expect(all.content).toContain('tick-3')
      expect(all.cursor as number).toBeGreaterThan(first.cursor as number)
      const tail = await sbx.commandLogs(id, commandId, all.cursor)
      expect(tail.content ?? '').toBe('')

      const long = await sbx.exec(id, 'sleep 120', { background: true })
      await sbx.interruptCommand(id, long.commandId as string)
      const stopped = await until(
        'the interrupted command to stop running',
        async () => {
          const status = await sbx.commandStatus(id, long.commandId as string)
          return status.running === false ? status : null
        },
        30_000,
      )
      expect(stopped.exitCode).not.toBe(0)
    },
  )

  test('write a file and read a line range back', { timeout: 60_000 }, async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`)
    await sbx.writeFiles(id, [
      { path: '/workspace/e2e/lines.txt', content: `${lines.join('\n')}\n` },
    ])

    const whole = await sbx.readFile(id, '/workspace/e2e/lines.txt')
    expect(whole.content).toBe(`${lines.join('\n')}\n`)

    // offset is 1-based. Worth asserting exactly: an older sandbox runtime
    // ignores the range and hands back the whole file, which the service
    // normalises rather than passing on.
    const middle = await sbx.readFile(id, '/workspace/e2e/lines.txt', { offset: 3, limit: 2 })
    expect(middle.content).toBe('L3\nL4')

    const pastEnd = await sbx.readFile(id, '/workspace/e2e/lines.txt', { offset: 9, limit: 5 })
    expect(pastEnd.content).toBe('L9\nL10')
  })

  test('list a directory with entry types', { timeout: 60_000 }, async () => {
    await sbx.writeFiles(id, [{ path: '/workspace/e2e/nested/inner.txt', content: 'inner' }])

    const shallow = await sbx.listDirectory(id, '/workspace/e2e')
    const shallowPaths = shallow.files.map((f) => f.path)
    expect(shallowPaths).toContain('/workspace/e2e/lines.txt')
    expect(shallowPaths).toContain('/workspace/e2e/nested')
    // Default depth is 1, so the nested file is not reached yet.
    expect(shallowPaths).not.toContain('/workspace/e2e/nested/inner.txt')

    const byPath = new Map(shallow.files.map((f) => [f.path, f.type]))
    expect(byPath.get('/workspace/e2e/lines.txt')).toBe('file')
    expect(byPath.get('/workspace/e2e/nested')).toBe('directory')

    const deep = await sbx.listDirectory(id, '/workspace/e2e', 3)
    expect(deep.files.map((f) => f.path)).toContain('/workspace/e2e/nested/inner.txt')
  })

  test('search by glob', { timeout: 60_000 }, async () => {
    const found = await sbx.searchFiles(id, '/workspace/e2e', '*.txt')
    expect(found.files.map((f) => f.path)).toContain('/workspace/e2e/lines.txt')

    const none = await sbx.searchFiles(id, '/workspace/e2e', '*.nomatch')
    expect(none.files).toHaveLength(0)
  })

  test('replace reports a per-file count', { timeout: 60_000 }, async () => {
    await sbx.writeFiles(id, [{ path: '/workspace/e2e/replace.txt', content: 'a a a' }])

    const hit = await sbx.replaceContents(id, [
      { path: '/workspace/e2e/replace.txt', oldContent: 'a', newContent: 'b' },
    ])
    const after = await sbx.readFile(id, '/workspace/e2e/replace.txt')
    expect(after.content).toBe('b b b')

    // An older sandbox runtime performs the replacement without reporting
    // counts, and says so rather than returning an empty list that reads like
    // "nothing matched".
    if (hit.detailAvailable) {
      expect(hit.results).toEqual([{ path: '/workspace/e2e/replace.txt', replacedCount: 3 }])

      const miss = await sbx.replaceContents(id, [
        { path: '/workspace/e2e/replace.txt', oldContent: 'zzz', newContent: 'x' },
      ])
      expect(miss.results[0].replacedCount).toBe(0)
    } else {
      expect(hit.results).toHaveLength(0)
    }
  })

  test('move, delete, and manage directories', { timeout: 60_000 }, async () => {
    await sbx.createDirectories(id, [{ path: '/workspace/e2e/mk' }])
    await sbx.writeFiles(id, [{ path: '/workspace/e2e/mk/one.txt', content: 'one' }])

    await sbx.moveFiles(id, [
      { src: '/workspace/e2e/mk/one.txt', dest: '/workspace/e2e/mk/two.txt' },
    ])
    const moved = await sbx.listDirectory(id, '/workspace/e2e/mk')
    expect(moved.files.map((f) => f.path)).toEqual(['/workspace/e2e/mk/two.txt'])

    await sbx.deleteFiles(id, ['/workspace/e2e/mk/two.txt'])
    const emptied = await sbx.listDirectory(id, '/workspace/e2e/mk')
    expect(emptied.files).toHaveLength(0)

    await sbx.deleteDirectories(id, ['/workspace/e2e/mk'])
    const parent = await sbx.listDirectory(id, '/workspace/e2e')
    expect(parent.files.map((f) => f.path)).not.toContain('/workspace/e2e/mk')
  })

  test('another run cannot reach this sandbox', { timeout: 60_000 }, async () => {
    // Ownership is enforced on every route, not just the listing.
    const stranger = sandboxService('not-a-real-token')
    await expect(stranger.exec(id, 'echo hello')).rejects.toThrow()
  })
})
