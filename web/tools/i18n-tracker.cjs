#!/usr/bin/env node
/**
 * Behavior
 * --------
 *   • Uses .i18n-tracker.lock at repo root to store { path: md5 }.
 *   • Scan mode never writes hashes.
 *   • Update mode rewrites only the given file's hash (creates file if absent).
 *   • Update-all mode rewrites all pending files' hashes.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const HASH_FILE = '.i18n-tracker.lock'
const FILE_REGEX = /\.(tsx?)$/
const ROOT = process.cwd()

const loadHashes = () => {
  if (!fs.existsSync(HASH_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(HASH_FILE, 'utf8'))
  } catch (error) {
    console.error(`Failed to parse ${HASH_FILE}: ${error}`)
    process.exit(1)
  }
}

const saveHashes = (map) => fs.writeFileSync(HASH_FILE, `${JSON.stringify(map, null, 2)}\n`)

const md5Of = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  return crypto.createHash('md5').update(content, 'utf8').digest('hex')
}

function shouldTrack(relPath) {
  if (relPath.includes('.d.ts')) return false
  if (relPath.includes('.test.')) return false
  return FILE_REGEX.test(relPath)
}

if (process.argv[2] === 'update' || process.argv[2] === '-u' || process.argv[2] === '--update') {
  const rel = process.argv[3]
  if (!rel) {
    console.error('Usage: node tools/i18n-tracker.cjs update <relativePath>')
    process.exit(1)
  }
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${rel}`)
    process.exit(1)
  }
  if (!shouldTrack(rel)) {
    console.log(`Skipping untracked file: ${rel}`)
    process.exit(0)
  }

  const hashes = loadHashes()
  hashes[rel] = md5Of(abs)
  saveHashes(hashes)
  console.log(`Hash updated for: ${rel}`)
  process.exit(0)
}

if (process.argv[2] === 'update-all' || process.argv[2] === '--update-all') {
  const hashes = loadHashes()
  let updated = 0
  const targets = walk(path.join(ROOT, 'src'))
  const pending = []

  for (const rel of targets) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) continue
    const curHash = md5Of(abs)
    if (!hashes[rel] || hashes[rel] !== curHash) {
      pending.push(rel)
    }
  }

  if (pending.length === 0) {
    console.log('All files are already up to date.')
    process.exit(0)
  }

  console.log(`Updating ${pending.length} file(s)...`)
  for (const rel of pending) {
    const abs = path.join(ROOT, rel)
    hashes[rel] = md5Of(abs)
    updated++
    console.log(`  ✓ ${rel}`)
  }

  saveHashes(hashes)
  console.log(`\nSuccessfully updated ${updated} file(s).`)
  process.exit(0)
}

let limit = null
let soft = false

const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-l':
    case '--limit':
      limit = Number.parseInt(args[++i], 10)
      break
    case '--soft':
      soft = true
      break
    case '-h':
    case '--help':
      console.log(`Usage:
  Scan mode        : node tools/i18n-tracker.cjs [--soft] [-l <n>]
  Update mode      : node tools/i18n-tracker.cjs update <relativePath>
  Update all mode  : node tools/i18n-tracker.cjs update-all

Options (scan):
  -l, --limit <n>    show at most <n> pending files
  --soft             always exit with code 0
  -h, --help         display this help
`)
      process.exit(0)
      break
    default:
      console.error(`Unknown option: ${args[i]}`)
      process.exit(1)
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []

  const stack = [dir]
  const out = []
  while (stack.length) {
    const current = stack.pop()
    for (const item of fs.readdirSync(current)) {
      const fullPath = path.join(current, item)
      if (item === 'node_modules' || item === 'dist' || item.startsWith('.')) {
        continue
      }
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        stack.push(fullPath)
      } else if (stat.isFile()) {
        const rel = path.relative(ROOT, fullPath)
        if (shouldTrack(rel)) {
          out.push(rel)
        }
      }
    }
  }
  return out
}

const oldMap = loadHashes()
let hasChanges = false

for (const rel in oldMap) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    delete oldMap[rel]
    hasChanges = true
  }
}

if (hasChanges) {
  saveHashes(oldMap)
}

const targets = walk(path.join(ROOT, 'src'))
const pending = []

for (const rel of targets) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) continue
  const curHash = md5Of(abs)
  if (!oldMap[rel] || oldMap[rel] !== curHash) {
    pending.push(rel)
  }
}

if (pending.length) {
  const shown = limit && pending.length > limit ? pending.slice(0, limit) : pending
  console.error(`\n❌ ${pending.length} file(s) changed since last i18n review:\n`)
  for (const rel of shown) {
    console.error(`  ${rel}`)
  }
  console.error(`
What this means:
  These files have been modified but not yet reviewed for i18n compliance.
  Every user-facing string should use t() from react-i18next, with keys in src/locales/*.json.

How to fix:
  1. Review each file and migrate user-facing text to t("key")
  2. Add missing keys to src/locales/en-US.json
  3. Mark reviewed:  node tools/i18n-tracker.cjs update <file>
     Or mark all:    node tools/i18n-tracker.cjs update-all

See: ../contributing/i18n.md
`)
  process.exit(soft ? 0 : 1)
}

console.log('✅ All files are up to date. No i18n work needed.')
