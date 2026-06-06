import { beforeEach, describe, expect, test } from 'vitest'
import { SkillManager, type Fs, type Shell, type FetchResponse } from './index.ts'

// ── In-memory DI implementations ──

function createMemFs(): Fs & { files: Map<string, Buffer | string>; dirs: Set<string> } {
  const files = new Map<string, Buffer | string>()
  const dirs = new Set<string>()

  return {
    files,
    dirs,
    exists(path) {
      return files.has(path) || dirs.has(path)
    },
    async mkdir(path) {
      dirs.add(path)
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
    async readFile(path) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return Buffer.isBuffer(content) ? content : Buffer.from(content)
    },
    async rm(path) {
      files.delete(path)
      dirs.delete(path)
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = new Set<string>()
      for (const key of [...files.keys(), ...dirs]) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          const name = rest.split('/')[0]
          if (name) names.add(name)
        }
      }
      return [...names]
    },
    async rename(from, to) {
      const fromPrefix = from.endsWith('/') ? from : `${from}/`
      const toPrefix = to.endsWith('/') ? to : `${to}/`
      // Move the directory entry itself (if any) and every nested key.
      if (dirs.has(from)) {
        dirs.delete(from)
        dirs.add(to)
      }
      for (const key of [...dirs]) {
        if (key.startsWith(fromPrefix)) {
          dirs.delete(key)
          dirs.add(toPrefix + key.slice(fromPrefix.length))
        }
      }
      for (const key of [...files.keys()]) {
        if (key === from) {
          files.set(to, files.get(from)!)
          files.delete(from)
        } else if (key.startsWith(fromPrefix)) {
          files.set(toPrefix + key.slice(fromPrefix.length), files.get(key)!)
          files.delete(key)
        }
      }
    },
  }
}

function createMemShell(): Shell & { calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = []
  return {
    calls,
    async exec(cmd, args) {
      calls.push({ cmd, args })
    },
  }
}

function headers(map: Record<string, string> = {}): { get(name: string): string | null } {
  return { get: (name) => map[name] ?? null }
}

function jsonResponse(data: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers: headers(),
    async json() { return data },
    async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(data)).buffer },
  }
}

function binaryResponse(buf: Buffer, etag?: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers: headers(etag ? { ETag: etag } : {}),
    async json() { throw new Error('not JSON') },
    async arrayBuffer() { return buf.buffer },
  }
}

function notModifiedResponse(etag: string): FetchResponse {
  return {
    ok: false,
    status: 304,
    headers: headers({ ETag: etag }),
    async json() { throw new Error('not JSON') },
    async arrayBuffer() { throw new Error('304 has no body') },
  }
}

function errorResponse(status: number): FetchResponse {
  return {
    ok: false,
    status,
    headers: headers(),
    async json() { throw new Error('error response') },
    async arrayBuffer() { throw new Error('error response') },
  }
}

// ── Tests ──

describe('SkillManager', () => {
  let fs: ReturnType<typeof createMemFs>
  let shell: ReturnType<typeof createMemShell>
  const SKILLS_DIR = '/workspace/.claude/skills'
  const LOCAL_BASE = '/tmp'

  function createManager(fetchImpl: (url: string) => Promise<FetchResponse>) {
    return new SkillManager({
      cpUrl: 'http://cp:3000',
      workspaceId: 'ws-1',
      skillsDir: SKILLS_DIR,
      localBase: LOCAL_BASE,
      useSymlink: true,
      fetch: fetchImpl,
      fs,
      shell,
    })
  }

  beforeEach(() => {
    fs = createMemFs()
    shell = createMemShell()
  })

  describe('load', () => {
    test('downloads and extracts skills', async () => {
      const tarBuf = Buffer.from('fake-tar-gz')
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: ['my-skill'] })
        if (url.includes('/_cp/skills/my-skill')) return binaryResponse(tarBuf)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'my-skill' }])
        throw new Error(`Unexpected fetch: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      const result = await mgr.load()

      expect(result.loaded).toEqual(['my-skill'])
      expect(result.failed).toEqual([])
      // tar extraction goes through a staging dir; assert by shape rather than exact path.
      const tarCall = shell.calls.find((c) => c.cmd === 'tar' && c.args[0] === 'xzf')
      expect(tarCall).toBeTruthy()
      expect(tarCall!.args[1]).toMatch(/\/tmp\/skill-my-skill\.staging-.+\/\.skill\.tar\.gz$/)
      // Symlink points at the canonical localDir after the staging swap.
      expect(shell.calls).toContainEqual({
        cmd: 'ln',
        args: ['-s', '/tmp/skill-my-skill', '/workspace/.claude/skills/my-skill'],
      })
    })

    test('sends If-None-Match and skips re-extract when ETag unchanged', async () => {
      const tarBuf = Buffer.from('fake-tar-gz')
      const ETAG = '"abc123"'
      const requests: (string | null)[] = []
      const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name: 'my-skill', id: 'sk-1' }] })
        if (url.includes('/_cp/skills/sk-1/package')) {
          const inm = init?.headers?.['If-None-Match'] ?? null
          requests.push(inm)
          return inm === ETAG ? notModifiedResponse(ETAG) : binaryResponse(tarBuf, ETAG)
        }
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'my-skill' }])
        throw new Error(`Unexpected fetch: ${url}`)
      }

      // First load: no prior ETag → unconditional download, sidecar recorded.
      await createManager(fetchImpl).load()
      expect(requests[0]).toBeNull()
      expect(fs.files.get('/tmp/.skill-etag-my-skill')).toBe(ETAG)

      // The in-memory shell's `ln` is a no-op, so materialize the symlink dest
      // that readKnownEtag verifies before trusting the sidecar.
      fs.dirs.add('/workspace/.claude/skills/my-skill')
      shell.calls.length = 0

      // Second load (fresh manager, same disk — mirrors a fanout reload):
      // carries If-None-Match, gets 304, skips download + extraction.
      const result = await createManager(fetchImpl).load()
      expect(requests[1]).toBe(ETAG)
      expect(result.loaded).toEqual(['my-skill'])
      expect(shell.calls.find((c) => c.cmd === 'tar')).toBeUndefined()
    })

    test('skips skills with .editing lockfile', async () => {
      // Pre-create skill directory with .editing lock
      fs.dirs.add('/tmp/skill-locked')
      fs.files.set('/tmp/skill-locked/.editing', '')

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: ['locked'] })
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'locked' }])
        throw new Error(`Should not download locked skill, but fetched: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      const result = await mgr.load()

      expect(result.editing).toEqual(['locked'])
      expect(result.loaded).toEqual([])
      // Should NOT have called tar or ln for this skill
      expect(shell.calls).toEqual([])
    })

    test('handles empty skill list', async () => {
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        if (url.includes('/_cp/skills')) return jsonResponse([])
        throw new Error(`Unexpected: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      const result = await mgr.load()
      expect(result).toEqual({ loaded: [], failed: [], editing: [] })
    })

    test('retries transient download failure and recovers', async () => {
      const tarBuf = Buffer.from('fake-tar-gz')
      let attempts = 0
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: ['flaky'] })
        if (url.includes('/_cp/skills/flaky')) {
          attempts++
          if (attempts < 3) return errorResponse(503)
          return binaryResponse(tarBuf)
        }
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'flaky' }])
        throw new Error(`Unexpected: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      const result = await mgr.load()
      expect(result.loaded).toEqual(['flaky'])
      expect(result.failed).toEqual([])
      expect(attempts).toBe(3)
    }, 20_000)

    test('exhausts retries and marks skill as failed without touching existing localDir', async () => {
      // Pre-existing valid extraction; retries will exhaust → existing must survive.
      fs.dirs.add('/tmp/skill-pinned')
      fs.files.set('/tmp/skill-pinned/SKILL.md', 'previous content')

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: ['pinned'] })
        if (url.includes('/_cp/skills/pinned')) return errorResponse(500)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'pinned' }])
        throw new Error(`Unexpected: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      const result = await mgr.load()
      expect(result.loaded).toEqual([])
      expect(result.failed).toEqual(['pinned'])
      // Existing extraction was not wiped by load() — atomic swap preserves it.
      expect(fs.files.get('/tmp/skill-pinned/SKILL.md')).toBe('previous content')
    }, 20_000)

    test('throws on list fetch failure', async () => {
      const fetchImpl = async () => errorResponse(500)
      const mgr = createManager(fetchImpl)
      await expect(mgr.load()).rejects.toThrow('Skills list fetch failed: 500')
    })

    test('parses new format with editable flag', async () => {
      const tarBuf = Buffer.from('fake-tar-gz')
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({
          skills: [
            { name: 'mine', editable: true },
            { name: 'others', editable: false },
          ],
        })
        if (url.includes('/_cp/skills/mine') || url.includes('/_cp/skills/others')) return binaryResponse(tarBuf)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'mine' }, { name: 'others' }])
        throw new Error(`Unexpected: ${url}`)
      }

      const mgr = createManager(fetchImpl)
      await mgr.load()
      expect(mgr.isEditable('mine')).toBe(true)
      expect(mgr.isEditable('others')).toBe(false)
    })
  })

  describe('editing lockfile', () => {
    /** Helper: create a manager that has loaded a skill with editable=true */
    async function loadedManager(skillName: string) {
      const tarBuf = Buffer.from('fake')
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({
          skills: [{ name: skillName, editable: true }],
        })
        if (url.includes(`/_cp/skills/${skillName}`)) return binaryResponse(tarBuf)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: skillName }])
        throw new Error(`Unexpected: ${url}`)
      }
      const mgr = createManager(fetchImpl)
      await mgr.load()
      return mgr
    }

    test('startEditing creates lockfile, isEditing returns true', async () => {
      const mgr = await loadedManager('test')

      expect(mgr.isEditing('test')).toBe(false)
      await mgr.startEditing('test')
      expect(mgr.isEditing('test')).toBe(true)
      expect(fs.files.has('/tmp/skill-test/.editing')).toBe(true)
    })

    test('stopEditing removes lockfile', async () => {
      const mgr = await loadedManager('test')
      await mgr.startEditing('test')

      expect(mgr.isEditing('test')).toBe(true)
      await mgr.stopEditing('test')
      expect(mgr.isEditing('test')).toBe(false)
    })

    test('startEditing throws if skill not editable', async () => {
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({
          skills: [{ name: 'readonly', editable: false }],
        })
        if (url.includes('/_cp/skills/readonly')) return binaryResponse(Buffer.from('x'))
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'readonly' }])
        throw new Error(`Unexpected: ${url}`)
      }
      const mgr = createManager(fetchImpl)
      await mgr.load()
      await expect(mgr.startEditing('readonly')).rejects.toThrow('Not allowed to edit skill')
    })

    test('startEditing throws if skill not found locally', async () => {
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [{ name: 'ghost', editable: true }] })
        if (url.includes('/_cp/skills/ghost')) return errorResponse(404)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'ghost' }])
        throw new Error(`Unexpected: ${url}`)
      }
      const mgr = createManager(fetchImpl)
      await mgr.load()
      await expect(mgr.startEditing('ghost')).rejects.toThrow('Skill not found locally')
    })

    test('stopEditing is idempotent', async () => {
      const mgr = createManager(async () => { throw new Error('no fetch') })
      // Should not throw even if lockfile doesn't exist
      await mgr.stopEditing('nonexistent')
    })
  })

  describe('createDraft', () => {
    test('creates directory with SKILL.md template and enters editing mode', async () => {
      const mgr = createManager(async () => { throw new Error('no fetch') })
      await mgr.createDraft('new-skill')

      // Should have created the local dir
      expect(fs.dirs.has('/tmp/skill-new-skill')).toBe(true)
      // Should have written SKILL.md with name substituted
      const content = fs.files.get('/tmp/skill-new-skill/SKILL.md')
      expect(content).toContain('name: new-skill')
      expect(content).toContain('# new-skill')
      // Should be in editing mode
      expect(fs.files.has('/tmp/skill-new-skill/.editing')).toBe(true)
      // Should have created symlink
      expect(shell.calls).toContainEqual({
        cmd: 'ln',
        args: ['-s', '/tmp/skill-new-skill', '/workspace/.claude/skills/new-skill'],
      })
    })
  })

  describe('pack', () => {
    test('creates tar.gz and returns buffer', async () => {
      fs.dirs.add('/tmp/skill-pkg')
      fs.files.set('/tmp/skill-pkg/SKILL.md', '# test')

      const mgr = createManager(async () => { throw new Error('no fetch') })

      // pack() calls tar czf, which in real env writes the file.
      // In our mem fs, we simulate by writing the tar file in shell.exec.
      const origExec = shell.exec.bind(shell)
      shell.exec = async (cmd, args) => {
        await origExec(cmd, args)
        if (cmd === 'tar' && args[0] === 'czf') {
          // Simulate tar creating the output file
          fs.files.set(args[1], Buffer.from('packed-content'))
        }
      }

      const buf = await mgr.pack('pkg')
      expect(buf.toString()).toBe('packed-content')

      // Should have called tar with --exclude .editing
      const tarCall = shell.calls.find(c => c.cmd === 'tar' && c.args[0] === 'czf')
      expect(tarCall).toBeTruthy()
      expect(tarCall!.args).toContain('--exclude')
      expect(tarCall!.args).toContain('.editing')

      // Temp tar file should be cleaned up
      expect(fs.files.has('/tmp/skill-pkg-publish.tar.gz')).toBe(false)
    })

    test('throws if skill not found', async () => {
      const mgr = createManager(async () => { throw new Error('no fetch') })
      await expect(mgr.pack('nope')).rejects.toThrow('Skill not found locally')
    })
  })

  describe('listLocal', () => {
    test('returns skill names from skillsDir', async () => {
      fs.dirs.add('/workspace/.claude/skills/alpha')
      fs.dirs.add('/workspace/.claude/skills/beta')
      fs.dirs.add('/tmp/skill-alpha')
      fs.dirs.add('/tmp/skill-beta')

      const mgr = createManager(async () => { throw new Error('no fetch') })
      const names = await mgr.listLocal()
      expect(names.sort()).toEqual(['alpha', 'beta'])
    })

    test('filters out dangling symlinks (target gone)', async () => {
      fs.dirs.add('/workspace/.claude/skills/alpha')
      fs.dirs.add('/workspace/.claude/skills/orphan')
      fs.dirs.add('/tmp/skill-alpha')
      // /tmp/skill-orphan deliberately missing

      const mgr = createManager(async () => { throw new Error('no fetch') })
      const names = await mgr.listLocal()
      expect(names).toEqual(['alpha'])
    })

    test('returns empty array if skillsDir missing', async () => {
      const mgr = createManager(async () => { throw new Error('no fetch') })
      const names = await mgr.listLocal()
      expect(names).toEqual([])
    })
  })

  describe('load orphan sweep', () => {
    test('pre-sweep removes dangling symlinks (localDir gone after restart)', async () => {
      // Symlink present on NFS but its /tmp target is gone (pod restart wiped it).
      fs.dirs.add('/workspace/.claude/skills/orphan')
      // /tmp/skill-orphan intentionally missing

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        throw new Error(`Unexpected: ${url}`)
      }

      await createManager(fetchImpl).load()
      expect(fs.exists('/workspace/.claude/skills/orphan')).toBe(false)
    })

    test('preserves drafts (present locally, no .managed marker)', async () => {
      fs.dirs.add('/workspace/.claude/skills/my-draft')
      fs.dirs.add('/tmp/skill-my-draft')
      fs.files.set('/tmp/skill-my-draft/SKILL.md', 'draft content')
      // No /tmp/.skill-managed-my-draft → treated as a local draft → never swept.

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        throw new Error(`Unexpected: ${url}`)
      }

      await createManager(fetchImpl).load()
      expect(fs.exists('/workspace/.claude/skills/my-draft')).toBe(true)
      expect(fs.exists('/tmp/skill-my-draft/SKILL.md')).toBe(true)
    })

    test('removes a managed skill no longer enabled (has .managed marker)', async () => {
      // A CP skill previously downloaded (carries .managed) and now absent from
      // the workspace's enabled list.
      fs.dirs.add('/workspace/.claude/skills/gone')
      fs.dirs.add('/tmp/skill-gone')
      fs.files.set('/tmp/skill-gone/SKILL.md', 'managed content')
      fs.files.set('/tmp/.skill-managed-gone', '')

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        throw new Error(`Unexpected: ${url}`)
      }

      await createManager(fetchImpl).load()
      expect(fs.exists('/workspace/.claude/skills/gone')).toBe(false)
      expect(fs.exists('/tmp/skill-gone')).toBe(false)
      expect(fs.exists('/tmp/.skill-managed-gone')).toBe(false)
    })

    test('does not touch enabled skills', async () => {
      fs.dirs.add('/workspace/.claude/skills/kept')
      fs.dirs.add('/tmp/skill-kept')

      const tarBuf = Buffer.from('fake')
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name: 'kept', editable: true }] })
        if (url.includes('/_cp/skills/kept')) return binaryResponse(tarBuf)
        throw new Error(`Unexpected: ${url}`)
      }

      const result = await createManager(fetchImpl).load()
      expect(result.loaded).toEqual(['kept'])
      // Stamped as managed but kept (still enabled).
      expect(fs.exists('/tmp/.skill-managed-kept')).toBe(true)
    })

    test('stamps .managed on the unchanged (304) path too', async () => {
      const ETAG = '"v1"'
      fs.dirs.add('/workspace/.claude/skills/cached')
      fs.dirs.add('/tmp/skill-cached')
      fs.files.set('/tmp/.skill-etag-cached', ETAG)
      // Note: no .skill-managed-cached yet — simulates a skill cached before the
      // marker existed; the 304 path must still stamp it.

      const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name: 'cached', id: 'sk-c' }] })
        if (url.includes('/_cp/skills/sk-c/package')) {
          return init?.headers?.['If-None-Match'] === ETAG
            ? notModifiedResponse(ETAG)
            : binaryResponse(Buffer.from('x'), ETAG)
        }
        throw new Error(`Unexpected: ${url}`)
      }

      const result = await createManager(fetchImpl).load()
      expect(result.loaded).toEqual(['cached'])
      expect(fs.exists('/tmp/.skill-managed-cached')).toBe(true)
    })
  })
})
