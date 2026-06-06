import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sweepUsage } from './node.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-usage-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeClaude(session: string, lines: string[], sub?: string[]): string {
  const dir = join(home, '.claude', 'projects', '-workspace')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${session}.jsonl`)
  writeFileSync(file, lines.join('\n'))
  if (sub) {
    const subDir = join(dir, session, 'subagents')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, 'agent-x.jsonl'), sub.join('\n'))
  }
  return file
}

function writeCodex(name: string, lines: string[]): void {
  const dir = join(home, '.codex', 'sessions', '2026', '05', '30')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `rollout-2026-05-30T00-00-00-${name}.jsonl`), lines.join('\n'))
}

const assistant = (id: string, out: number, cacheRead = 0) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-30T00:00:00.000Z',
    sessionId: 's',
    message: {
      id,
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: cacheRead },
    },
  })
const userLine = JSON.stringify({
  type: 'user',
  timestamp: '2026-05-30T00:00:01.000Z',
  message: { role: 'user' },
})
const codexMeta = (id: string) =>
  JSON.stringify({
    type: 'session_meta',
    timestamp: 't',
    payload: { id, originator: 'codex_cli_rs' },
  })
const codexTC = (input: number, total: number) =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: 't',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: input, total_tokens: total } },
    },
  })

const SETTLED = { now: Date.now() + 1e9 } // far future → all files quiescent

describe('sweepUsage', () => {
  test('scans both trees and merges sub-agent records into the parent session', () => {
    writeClaude('sess-a', [assistant('m1', 100), userLine], [assistant('sub1', 50, 999), userLine])
    writeCodex('cdx-1', [codexMeta('cdx-1'), codexTC(40, 40)])

    const { records } = sweepUsage({ homeDir: home, fallbackModel: 'gpt-5.5', ...SETTLED })
    const claude = records.filter((r) => r.source === 'claude')
    const codex = records.filter((r) => r.source === 'codex')

    expect(claude).toHaveLength(2)
    // sub-agent record attributed to the parent session id (the .jsonl basename)
    expect(claude.every((r) => r.sessionId === 'sess-a')).toBe(true)
    expect(claude.find((r) => r.dedupKey === 'claude:sub1')?.cacheReadTokens).toBe(999)
    expect(codex).toHaveLength(1)
    expect(codex[0].model).toBe('gpt-5.5')
  })

  test('defers a trailing in-flight assistant while fresh, emits once quiescent (no stranding)', () => {
    // last entry is an assistant => possibly mid-stream
    const file = writeClaude('sess-b', [assistant('m1', 100), assistant('m2', 200)])

    // fresh file (mtime ~ now): trailing m2 deferred
    const fresh = sweepUsage({ homeDir: home, now: Date.now() })
    expect(fresh.records.map((r) => r.dedupKey)).toEqual(['claude:m1'])
    // Regression guard (stranding bug): a deferred-trailing file MUST NOT have
    // its cursor advanced — else the next sweep sees it `unchanged` and m2 is
    // stranded forever. Threading fresh.cursors into the next sweep is the real
    // production path (cp persists & re-sends the cursor).
    expect(file in fresh.cursors).toBe(false)

    // next sweep with the returned cursor + file now quiescent: m2 emitted
    const settled = sweepUsage({ homeDir: home, cursors: fresh.cursors, ...SETTLED })
    expect(settled.records.map((r) => r.dedupKey).sort()).toEqual(['claude:m1', 'claude:m2'])
  })

  test('is idempotent: a second sweep over unchanged files yields nothing new', () => {
    writeClaude('sess-c', [assistant('m1', 100), userLine])
    writeCodex('cdx-2', [codexMeta('cdx-2'), codexTC(10, 10)])

    const first = sweepUsage({ homeDir: home, ...SETTLED })
    expect(first.records.length).toBeGreaterThan(0)

    const second = sweepUsage({ homeDir: home, cursors: first.cursors, ...SETTLED })
    expect(second.records).toHaveLength(0)
  })

  test('re-reads a file after it changes (fingerprint mismatch)', () => {
    writeClaude('sess-d', [assistant('m1', 100), userLine])
    const first = sweepUsage({ homeDir: home, ...SETTLED })
    expect(first.records).toHaveLength(1)

    // append a new settled message
    writeClaude('sess-d', [assistant('m1', 100), assistant('m2', 200), userLine])
    const second = sweepUsage({ homeDir: home, cursors: first.cursors, ...SETTLED })
    // full re-parse of the changed file → both messages (ledger dedups m1 downstream)
    expect(second.records.map((r) => r.dedupKey).sort()).toEqual(['claude:m1', 'claude:m2'])
  })

  test('empty / missing home yields no records, no throw', () => {
    expect(sweepUsage({ homeDir: join(home, 'does-not-exist') }).records).toEqual([])
  })

  test('maxFiles caps changed files per call and drains across calls (hasMore)', () => {
    // 5 codex rollouts, each one settled token_count
    for (let i = 0; i < 5; i++) writeCodex(`cdx-${i}`, [codexMeta(`cdx-${i}`), codexTC(10, 10)])

    // batch 1: cap at 2 → 2 records, hasMore true
    const b1 = sweepUsage({ homeDir: home, maxFiles: 2, ...SETTLED })
    expect(b1.records).toHaveLength(2)
    expect(b1.hasMore).toBe(true)

    // batch 2: resume with returned cursors → 2 more, still hasMore
    const b2 = sweepUsage({ homeDir: home, cursors: b1.cursors, maxFiles: 2, ...SETTLED })
    expect(b2.records).toHaveLength(2)
    expect(b2.hasMore).toBe(true)

    // batch 3: last one → 1 record, hasMore false
    const b3 = sweepUsage({ homeDir: home, cursors: b2.cursors, maxFiles: 2, ...SETTLED })
    expect(b3.records).toHaveLength(1)
    expect(b3.hasMore).toBe(false)

    // every file processed exactly once across the drain (5 distinct dedup keys)
    const allKeys = [...b1.records, ...b2.records, ...b3.records].map((r) => r.dedupKey)
    expect(new Set(allKeys).size).toBe(5)
    // a 4th pull after full drain yields nothing
    const b4 = sweepUsage({ homeDir: home, cursors: b3.cursors, maxFiles: 2, ...SETTLED })
    expect(b4.records).toHaveLength(0)
    expect(b4.hasMore).toBe(false)
  })

  test('unchanged files are retained in cursor even when the cap is hit', () => {
    // first full drain of 2 files
    writeCodex('a', [codexMeta('a'), codexTC(10, 10)])
    writeCodex('b', [codexMeta('b'), codexTC(20, 20)])
    const full = sweepUsage({ homeDir: home, ...SETTLED })
    expect(full.records).toHaveLength(2)

    // add a 3rd changed file, pull with cap 1: the 1 new file is read, the 2
    // unchanged ones stay retained (cursor still has all 3), hasMore false
    writeCodex('c', [codexMeta('c'), codexTC(30, 30)])
    const next = sweepUsage({ homeDir: home, cursors: full.cursors, maxFiles: 1, ...SETTLED })
    expect(next.records.map((r) => r.dedupKey)).toEqual(['codex:c:30'])
    expect(next.hasMore).toBe(false)
    expect(Object.keys(next.cursors)).toHaveLength(3)
  })
})
