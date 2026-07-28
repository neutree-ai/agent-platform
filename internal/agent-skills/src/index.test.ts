import { beforeEach, describe, expect, test } from 'vitest'
import { SkillManager, type Fs, type Shell, type FetchResponse } from './index.ts'

// ── In-memory DI implementations ──

function createMemFs(): Fs & {
  files: Map<string, Buffer | string>
  dirs: Set<string>
  symlinks: Set<string>
} {
  const files = new Map<string, Buffer | string>()
  const dirs = new Set<string>()
  // Paths (already present in `dirs`) that are symlinks rather than real dirs.
  const symlinks = new Set<string>()

  return {
    files,
    dirs,
    symlinks,
    exists(path) {
      return files.has(path) || dirs.has(path)
    },
    isSymlink(path) {
      return symlinks.has(path)
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
      // Recursive, matching node's rm({ recursive: true, force: true }).
      files.delete(path)
      dirs.delete(path)
      symlinks.delete(path)
      const prefix = path.endsWith('/') ? path : `${path}/`
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k)
      for (const d of [...dirs]) if (d.startsWith(prefix)) dirs.delete(d)
      for (const s of [...symlinks]) if (s.startsWith(prefix)) symlinks.delete(s)
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

  function createManager(
    fetchImpl: (url: string) => Promise<FetchResponse>,
    overrides: { draftBase?: string } = {},
  ) {
    return new SkillManager({
      cpUrl: 'http://cp:3000',
      workspaceId: 'ws-1',
      skillsDir: SKILLS_DIR,
      localBase: LOCAL_BASE,
      useSymlink: true,
      fetch: fetchImpl,
      fs,
      shell,
      ...overrides,
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
      // Symlink points at the canonical localDir after the staging swap, created
      // idempotently with `ln -sfn` so concurrent replicas don't race rm/ln.
      expect(shell.calls).toContainEqual({
        cmd: 'ln',
        args: ['-sfn', '/tmp/skill-my-skill', '/workspace/.claude/skills/my-skill'],
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

  describe('discardChanges', () => {
    const ETAG = '"v1"'

    /**
     * Manager with `name` loaded from CP at ETag `v1`, in editing mode, plus a
     * stray file an agent wrote into the skill dir. `requests` records the
     * If-None-Match header of every package fetch.
     */
    async function editedManager(name: string) {
      const requests: (string | null)[] = []
      const tarBuf = Buffer.from('published-tar-gz')
      const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name, id: 'sk-1', editable: true }] })
        if (url.includes('/_cp/skills/sk-1/package')) {
          const inm = init?.headers?.['If-None-Match'] ?? null
          requests.push(inm)
          return inm === ETAG ? notModifiedResponse(ETAG) : binaryResponse(tarBuf, ETAG)
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }
      const mgr = createManager(fetchImpl)
      await mgr.load()
      // The in-memory shell's `ln` is a no-op; materialize the dest so the
      // ETag sidecar would be trusted (that's what discard has to defeat).
      fs.dirs.add(`${SKILLS_DIR}/${name}`)
      await mgr.startEditing(name)
      fs.files.set(`${LOCAL_BASE}/skill-${name}/rogue.md`, 'written by the agent')
      shell.calls.length = 0
      return { mgr, requests }
    }

    test('restores the published version, dropping local edits and the lock', async () => {
      const { mgr, requests } = await editedManager('test')

      await mgr.discardChanges('test')

      // Unconditional re-download: a 304 would have left the edits in place.
      expect(requests).toEqual([null, null])
      expect(fs.files.has('/tmp/skill-test/rogue.md')).toBe(false)
      expect(mgr.isEditing('test')).toBe(false)
      // Fresh extraction, and the ETag sidecar is back in sync.
      expect(shell.calls.find((c) => c.cmd === 'tar' && c.args[0] === 'xzf')).toBeTruthy()
      expect(fs.files.get('/tmp/.skill-etag-test')).toBe(ETAG)
      expect(fs.files.has('/tmp/.skill-managed-test')).toBe(true)
    })

    test('rejects a skill CP does not know, keeping the only copy intact', async () => {
      const mgr = createManager(async () => {
        throw new Error('discardChanges must not fetch for an unpublished draft')
      })
      await mgr.createDraft('brand-new')

      await expect(mgr.discardChanges('brand-new')).rejects.toThrow('No published version')
      expect(fs.files.has('/tmp/skill-brand-new/SKILL.md')).toBe(true)
      expect(mgr.isEditing('brand-new')).toBe(true)
    })

    test('rejects a reserved platform skill name', async () => {
      const mgr = createManager(async () => { throw new Error('no fetch') })
      await expect(mgr.discardChanges('__platform__')).rejects.toThrow('reserved')
    })

    test('leaves edits untouched when the download exhausts its retries', async () => {
      const tarBuf = Buffer.from('published-tar-gz')
      let failDownloads = false
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name: 'flaky', id: 'sk-1', editable: true }] })
        if (url.includes('/_cp/skills/sk-1/package'))
          return failDownloads ? errorResponse(503) : binaryResponse(tarBuf)
        throw new Error(`Unexpected fetch: ${url}`)
      }
      const mgr = createManager(fetchImpl)
      await mgr.load()
      await mgr.startEditing('flaky')
      fs.files.set('/tmp/skill-flaky/rogue.md', 'written by the agent')
      failDownloads = true

      await expect(mgr.discardChanges('flaky')).rejects.toThrow('Failed to fetch published version')
      // Nothing was swapped out: the user still has their work and their lock.
      expect(fs.files.get('/tmp/skill-flaky/rogue.md')).toBe('written by the agent')
      expect(mgr.isEditing('flaky')).toBe(true)
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

    test('tars a local snapshot, not the (possibly NFS) source dir', async () => {
      fs.dirs.add('/workspace/.skills-draft/skill-pkg')
      fs.files.set('/workspace/.skills-draft/skill-pkg/SKILL.md', '# test')

      const mgr = createManager(async () => { throw new Error('no fetch') }, {
        draftBase: '/workspace/.skills-draft',
      })

      const origExec = shell.exec.bind(shell)
      shell.exec = async (cmd, args) => {
        await origExec(cmd, args)
        if (cmd === 'tar' && args[0] === 'czf') {
          fs.files.set(args[1], Buffer.from('packed-content'))
        }
      }

      const buf = await mgr.pack('pkg')
      expect(buf.toString()).toBe('packed-content')

      // cp -a copies the draft dir contents into a tmpfs snapshot...
      const cpCall = shell.calls.find(c => c.cmd === 'cp')
      expect(cpCall).toBeTruthy()
      expect(cpCall!.args[1]).toBe('/workspace/.skills-draft/skill-pkg/.')
      const snapshot = cpCall!.args[2]
      expect(snapshot.startsWith('/tmp/skill-pkg.pack-')).toBe(true)

      // ...and tar reads that snapshot, never the draft dir itself.
      const tarCall = shell.calls.find(c => c.cmd === 'tar' && c.args[0] === 'czf')
      expect(tarCall!.args[tarCall!.args.indexOf('-C') + 1]).toBe(snapshot)

      // Snapshot is cleaned up.
      expect(fs.dirs.has(snapshot)).toBe(false)
    })

    test('sweeps snapshot dirs leaked by a crashed pack', async () => {
      fs.dirs.add('/tmp/skill-pkg')
      fs.files.set('/tmp/skill-pkg/SKILL.md', '# test')
      fs.dirs.add('/tmp/skill-pkg.pack-999-1')
      fs.dirs.add('/tmp/skill-pkg.pack-999-2')

      const mgr = createManager(async () => { throw new Error('no fetch') })
      const origExec = shell.exec.bind(shell)
      shell.exec = async (cmd, args) => {
        await origExec(cmd, args)
        if (cmd === 'tar' && args[0] === 'czf') {
          fs.files.set(args[1], Buffer.from('packed-content'))
        }
      }

      await mgr.pack('pkg')

      expect(fs.dirs.has('/tmp/skill-pkg.pack-999-1')).toBe(false)
      expect(fs.dirs.has('/tmp/skill-pkg.pack-999-2')).toBe(false)
      expect(fs.dirs.has('/tmp/skill-pkg')).toBe(true)
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
      fs.symlinks.add('/workspace/.claude/skills/orphan')
      // /tmp/skill-orphan intentionally missing

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        throw new Error(`Unexpected: ${url}`)
      }

      await createManager(fetchImpl).load()
      expect(fs.exists('/workspace/.claude/skills/orphan')).toBe(false)
    })

    test('pre-sweep preserves hand-added real directories (not symlinks)', async () => {
      // A user dropped a skill directory straight into skillsDir: a real dir,
      // no /tmp target, no .managed marker. It must survive both sweeps.
      fs.dirs.add('/workspace/.claude/skills/hand-added')
      fs.files.set('/workspace/.claude/skills/hand-added/SKILL.md', 'hand-authored')
      // /tmp/skill-hand-added intentionally missing

      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
        throw new Error(`Unexpected: ${url}`)
      }

      await createManager(fetchImpl).load()
      expect(fs.exists('/workspace/.claude/skills/hand-added')).toBe(true)
      expect(fs.exists('/workspace/.claude/skills/hand-added/SKILL.md')).toBe(true)
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

describe('SkillManager draft persistence (draftBase)', () => {
  let fs: ReturnType<typeof createMemFs>
  let shell: ReturnType<typeof createMemShell>
  const SKILLS_DIR = '/workspace/.claude/skills'
  const LOCAL_BASE = '/tmp'
  const DRAFT_BASE = '/workspace/.skills-draft'

  function createManager(fetchImpl: (url: string) => Promise<FetchResponse>) {
    return new SkillManager({
      cpUrl: 'http://cp:3000',
      workspaceId: 'ws-1',
      skillsDir: SKILLS_DIR,
      localBase: LOCAL_BASE,
      draftBase: DRAFT_BASE,
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

  test('createDraft places content + lock on the persistent draftBase, not tmpfs', async () => {
    const mgr = createManager(async () => {
      throw new Error('createDraft should not fetch')
    })
    await mgr.createDraft('my-draft')

    // Content and the .editing lock live under draftBase → survive a pod rebuild.
    expect(fs.dirs.has('/workspace/.skills-draft/skill-my-draft')).toBe(true)
    expect(fs.files.has('/workspace/.skills-draft/skill-my-draft/SKILL.md')).toBe(true)
    expect(fs.files.has('/workspace/.skills-draft/skill-my-draft/.editing')).toBe(true)
    // Nothing was written to tmpfs.
    expect(fs.dirs.has('/tmp/skill-my-draft')).toBe(false)
    // Symlink points at the persistent draft dir.
    expect(shell.calls).toContainEqual({
      cmd: 'ln',
      args: ['-s', '/workspace/.skills-draft/skill-my-draft', '/workspace/.claude/skills/my-draft'],
    })
  })

  test('load preserves an unpublished draft after a rebuild (tmpfs wiped, draftBase intact)', async () => {
    // A draft on persistent NFS, not enabled in CP (never published).
    fs.dirs.add('/workspace/.skills-draft/skill-wip')
    fs.files.set('/workspace/.skills-draft/skill-wip/SKILL.md', 'draft body')
    fs.dirs.add('/workspace/.claude/skills/wip') // symlink dest, still materialized

    const fetchImpl = async (url: string) => {
      if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: [] })
      throw new Error(`Unexpected fetch: ${url}`)
    }
    const result = await createManager(fetchImpl).load()

    // Draft content untouched; not swept as an orphan.
    expect(fs.dirs.has('/workspace/.skills-draft/skill-wip')).toBe(true)
    expect(fs.files.get('/workspace/.skills-draft/skill-wip/SKILL.md')).toBe('draft body')
    expect(result.loaded).toEqual([])
  })

  test('load recognises a still-editing draft via the NFS lock after a rebuild', async () => {
    fs.dirs.add('/workspace/.skills-draft/skill-wip')
    fs.files.set('/workspace/.skills-draft/skill-wip/.editing', '')
    fs.dirs.add('/workspace/.claude/skills/wip')

    const fetchImpl = async (url: string) => {
      if (url.includes('/workspaces/ws-1/skills'))
        return jsonResponse({ skills: [{ name: 'wip', id: 'sk-wip' }] })
      if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'wip' }])
      throw new Error(`Should not download a skill being edited: ${url}`)
    }
    const result = await createManager(fetchImpl).load()

    expect(result.editing).toEqual(['wip'])
    expect(shell.calls.find((c) => c.cmd === 'tar')).toBeUndefined()
  })

  test('startEditing promotes a published skill (tmpfs) into a persistent draft', async () => {
    // Published skill content present on tmpfs (as after a normal load).
    fs.dirs.add('/tmp/skill-pub')
    fs.files.set('/tmp/skill-pub/SKILL.md', 'published body')

    const mgr = createManager(async () => {
      throw new Error('startEditing should not fetch')
    })
    await mgr.startEditing('pub')

    // Copied to draftBase via `cp -a` (preserves +x), re-symlinked, lock on NFS.
    expect(shell.calls).toContainEqual({
      cmd: 'cp',
      args: ['-a', '/tmp/skill-pub/.', '/workspace/.skills-draft/skill-pub'],
    })
    expect(shell.calls).toContainEqual({
      cmd: 'ln',
      args: ['-s', '/workspace/.skills-draft/skill-pub', '/workspace/.claude/skills/pub'],
    })
    expect(fs.files.has('/workspace/.skills-draft/skill-pub/.editing')).toBe(true)
    // The tmpfs copy is dropped; the draft is now authoritative.
    expect(fs.dirs.has('/tmp/skill-pub')).toBe(false)
  })

  test('load reclaims a stale draft once the skill is published (enabled + not editing)', async () => {
    // Draft dir lingers on NFS with no lock, and CP now lists it as enabled.
    fs.dirs.add('/workspace/.skills-draft/skill-done')
    fs.files.set('/workspace/.skills-draft/skill-done/SKILL.md', 'old draft')
    fs.dirs.add('/workspace/.claude/skills/done')

    const tarBuf = Buffer.from('fake-tar-gz')
    const fetchImpl = async (url: string) => {
      if (url.includes('/workspaces/ws-1/skills'))
        return jsonResponse({ skills: [{ name: 'done', id: 'sk-done' }] })
      if (url.includes('/_cp/skills/sk-done/package')) return binaryResponse(tarBuf)
      if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'done' }])
      throw new Error(`Unexpected fetch: ${url}`)
    }
    const result = await createManager(fetchImpl).load()

    // Stale NFS draft cleared; re-extracted onto tmpfs (staging dir under /tmp).
    expect(fs.dirs.has('/workspace/.skills-draft/skill-done')).toBe(false)
    const tarCall = shell.calls.find((c) => c.cmd === 'tar' && c.args[0] === 'xzf')
    expect(tarCall!.args[1]).toMatch(/^\/tmp\/skill-done\.staging-/)
    expect(result.loaded).toEqual(['done'])
  })

  test('discardChanges reclaims the persistent draft of a git-imported skill', async () => {
    const tarBuf = Buffer.from('published-tar-gz')
    const fetchImpl = async (url: string) => {
      if (url.includes('/workspaces/ws-1/skills'))
        return jsonResponse({
          skills: [{ name: 'imported', id: 'sk-g', editable: true, gitSource: true }],
        })
      if (url.includes('/_cp/skills/sk-g/package')) return binaryResponse(tarBuf)
      throw new Error(`Unexpected fetch: ${url}`)
    }
    const mgr = createManager(fetchImpl)
    await mgr.load()
    fs.dirs.add('/workspace/.claude/skills/imported')
    // Editing promotes the skill onto the persistent draftBase.
    await mgr.startEditing('imported')
    fs.files.set('/workspace/.skills-draft/skill-imported/rogue.md', 'written by the agent')
    shell.calls.length = 0

    await mgr.discardChanges('imported')

    // Draft reclaimed; content re-materialised on tmpfs and re-symlinked there.
    expect(fs.dirs.has('/workspace/.skills-draft/skill-imported')).toBe(false)
    expect(fs.files.has('/workspace/.skills-draft/skill-imported/rogue.md')).toBe(false)
    expect(shell.calls).toContainEqual({
      cmd: 'ln',
      args: ['-sfn', '/tmp/skill-imported', '/workspace/.claude/skills/imported'],
    })
    expect(mgr.isEditing('imported')).toBe(false)
    // Restoring from CP doesn't change where the skill came from.
    expect(mgr.isGitSource('imported')).toBe(true)
  })

  // installPlatformSkill runs on every agent boot. Under auto-scaling, N replicas
  // boot in parallel and install into the SAME shared skillsDir, so it must be
  // idempotent and never expose a half-written tree.
  describe('installPlatformSkill (concurrent-safe)', () => {
    const DEST = `${SKILLS_DIR}/__platform__`
    const VER = `${SKILLS_DIR}/.__platform__.version`
    const mgr = () =>
      createManager(async () => {
        throw new Error('installPlatformSkill must not fetch')
      })

    test('installs the tree, locks it readonly, and records a version', async () => {
      await mgr().installPlatformSkill({ 'SKILL.md': 'body', 'ref/a.md': 'A' })
      expect(fs.files.get(`${DEST}/SKILL.md`)).toBe('body')
      expect(fs.files.get(`${DEST}/ref/a.md`)).toBe('A')
      expect(fs.files.get(VER)).toBeTruthy()
      // The staged tree was chmod'd readonly before publishing.
      expect(shell.calls.some((c) => c.cmd === 'chmod' && c.args.includes('a-w'))).toBe(true)
      // No staging dir left behind.
      expect([...fs.dirs].some((d) => d.includes('.__platform__.staging-'))).toBe(false)
    })

    test('is a no-op when the same version is already installed (idempotent skip)', async () => {
      await mgr().installPlatformSkill({ 'SKILL.md': 'body' })
      shell.calls.length = 0
      const before = new Map(fs.files)
      // A second replica with identical content agrees on the version and skips.
      await mgr().installPlatformSkill({ 'SKILL.md': 'body' })
      expect(shell.calls).toEqual([])
      expect(fs.files).toEqual(before)
    })

    test('reinstalls and drops stale files when the content version changes', async () => {
      await mgr().installPlatformSkill({ 'SKILL.md': 'v1', 'old.md': 'gone' })
      const v1 = fs.files.get(VER)
      await mgr().installPlatformSkill({ 'SKILL.md': 'v2' })
      expect(fs.files.get(`${DEST}/SKILL.md`)).toBe('v2')
      expect(fs.files.has(`${DEST}/old.md`)).toBe(false)
      expect(fs.files.get(VER)).not.toBe(v1)
    })

    test('rejects a path-traversal entry', async () => {
      await expect(mgr().installPlatformSkill({ '../evil': 'x' })).rejects.toThrow(
        /Invalid platform skill path/,
      )
    })

    test('discards its staging and does not throw when a racer publishes first', async () => {
      // Model a sibling replica winning the publish: the rename into dest fails.
      const realRename = fs.rename
      fs.rename = async (from, to) => {
        if (to === DEST) throw new Error('EEXIST: published by a racer')
        return realRename(from, to)
      }
      await expect(mgr().installPlatformSkill({ 'SKILL.md': 'body' })).resolves.toBeUndefined()
      // The staged tree was chmod'd readonly before the failed publish, so the
      // loser MUST restore write before removing it — otherwise the readonly
      // dirs make rm fail and it leaks an undeletable staging on the shared
      // volume every racy cold-start.
      const restoredWrite = shell.calls.find(
        (c) =>
          c.cmd === 'chmod' &&
          c.args.includes('u+w') &&
          c.args.some((a) => a.includes('.__platform__.staging-')),
      )
      expect(restoredWrite).toBeTruthy()
      expect([...fs.dirs].some((d) => d.includes('.__platform__.staging-'))).toBe(false)
      expect([...fs.files.keys()].some((k) => k.includes('.__platform__.staging-'))).toBe(false)
      fs.rename = realRename
    })

    test('sweeps an orphaned stale staging dir but keeps a fresh sibling one', async () => {
      // A prior race/crash left a readonly staging behind; a sibling replica is
      // mid-install right now (fresh timestamp). Install should reap the orphan
      // and leave the live one alone.
      const stale = `${SKILLS_DIR}/.__platform__.staging-999-1` // ms=1 → ancient
      const fresh = `${SKILLS_DIR}/.__platform__.staging-888-${Date.now()}` // now → live
      for (const s of [stale, fresh]) {
        fs.dirs.add(s)
        fs.files.set(`${s}/SKILL.md`, 'x')
      }
      await mgr().installPlatformSkill({ 'SKILL.md': 'body' })
      expect(fs.exists(stale)).toBe(false) // orphan reaped
      expect(fs.exists(fresh)).toBe(true) // live sibling untouched
      // The reap restored write on the readonly orphan first.
      expect(
        shell.calls.some((c) => c.cmd === 'chmod' && c.args.includes('u+w') && c.args.includes(stale)),
      ).toBe(true)
    })
  })

  // Pre-sweep must not delete a still-enabled skill's symlink just because THIS
  // pod hasn't extracted its /tmp copy yet — under auto-scaling that symlink may
  // belong to a sibling replica that is already serving it.
  describe('pre-sweep (auto-scaling safe)', () => {
    test('preserves an enabled skill’s symlink when this pod has no local copy', async () => {
      // Sibling created skillsDir/foo → /tmp/skill-foo; here /tmp is empty, so it
      // is dangling on this pod. foo stays enabled and its download fails this
      // round — the symlink must survive rather than be swept.
      fs.dirs.add(`${SKILLS_DIR}/foo`)
      fs.symlinks.add(`${SKILLS_DIR}/foo`)
      const fetchImpl = async (url: string) => {
        if (url.includes('/workspaces/ws-1/skills'))
          return jsonResponse({ skills: [{ name: 'foo', id: 'sk-foo' }] })
        if (url.includes('/_cp/skills/sk-foo/package')) return errorResponse(500)
        if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'foo' }])
        throw new Error(`Unexpected fetch: ${url}`)
      }
      const result = await createManager(fetchImpl).load()
      expect(result.failed).toEqual(['foo'])
      expect(fs.symlinks.has(`${SKILLS_DIR}/foo`)).toBe(true)
    })
  })
})

describe('SkillManager staging cleanup', () => {
  let fs: ReturnType<typeof createMemFs>
  let shell: ReturnType<typeof createMemShell>

  function createManager(fetchImpl: (url: string) => Promise<FetchResponse>) {
    return new SkillManager({
      cpUrl: 'http://cp:3000',
      workspaceId: 'ws-1',
      skillsDir: '/workspace/.claude/skills',
      localBase: '/tmp',
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

  test('extract sweeps leaked .staging-* dirs for the same skill', async () => {
    // Two leaked staging dirs from prior crashed/concurrent extracts.
    fs.dirs.add('/tmp/skill-foo.staging-1-111')
    fs.dirs.add('/tmp/skill-foo.staging-1-222')
    // An unrelated skill's staging must NOT be touched.
    fs.dirs.add('/tmp/skill-bar.staging-1-333')

    const tarBuf = Buffer.from('fake-tar-gz')
    const fetchImpl = async (url: string) => {
      if (url.includes('/workspaces/ws-1/skills')) return jsonResponse({ skills: ['foo'] })
      if (url.includes('/_cp/skills/foo')) return binaryResponse(tarBuf)
      if (url.includes('/_cp/skills')) return jsonResponse([{ name: 'foo' }])
      throw new Error(`Unexpected fetch: ${url}`)
    }
    await createManager(fetchImpl).load()

    expect(fs.dirs.has('/tmp/skill-foo.staging-1-111')).toBe(false)
    expect(fs.dirs.has('/tmp/skill-foo.staging-1-222')).toBe(false)
    // Different skill untouched.
    expect(fs.dirs.has('/tmp/skill-bar.staging-1-333')).toBe(true)
  })
})
