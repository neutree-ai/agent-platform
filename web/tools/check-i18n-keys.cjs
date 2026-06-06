#!/usr/bin/env node
/**
 * Checks that all t("key") calls in source code reference keys
 * that actually exist in the locale files, and ensures locale
 * files stay aligned.
 *
 * Usage: node tools/check-i18n-keys.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const LOCALE_FILES = {
  enUS: 'src/locales/en-US.json',
  zhCN: 'src/locales/zh-CN.json',
}
const SRC_DIR = 'src'
const EXTENSIONS = ['.ts', '.tsx']

function flattenKeys(obj, prefix) {
  const keys = new Set()
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const nestedKey of flattenKeys(value, fullKey)) {
        keys.add(nestedKey)
      }
    } else {
      keys.add(fullKey)
    }
  }
  return keys
}

function collectFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    if (entry === 'node_modules' || entry === 'dist') continue
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath))
    } else if (EXTENSIONS.some((ext) => fullPath.endsWith(ext))) {
      files.push(fullPath)
    }
  }
  return files
}

const T_CALL_RE = /\bt\(\s*["'`]([^"'`]+)["'`]/g

function extractKeys(content) {
  const keys = []
  let match
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex.exec loop
  while ((match = T_CALL_RE.exec(content)) !== null) {
    keys.push(match[1])
  }
  return keys
}

function hasKeyOrPluralVariants(keySet, key) {
  if (keySet.has(key)) return true
  return keySet.has(`${key}_one`) && keySet.has(`${key}_other`)
}

const enUSLocale = JSON.parse(fs.readFileSync(LOCALE_FILES.enUS, 'utf8'))
const zhCNLocale = JSON.parse(fs.readFileSync(LOCALE_FILES.zhCN, 'utf8'))
const enUSKeys = flattenKeys(enUSLocale)
const zhCNKeys = flattenKeys(zhCNLocale)
const sourceFiles = collectFiles(SRC_DIR)

const missing = []

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8')
  for (const key of extractKeys(content)) {
    if (key.includes('${') || key.includes('{{')) continue
    if (!hasKeyOrPluralVariants(enUSKeys, key)) {
      missing.push({ file: path.relative('.', file), key })
    }
  }
}

if (missing.length > 0) {
  console.error(`\n❌ ${missing.length} missing i18n key(s):\n`)
  for (const { file, key } of missing) {
    console.error(`  ${file}: t("${key}")`)
  }
  console.error(`
How to fix:
  Add the missing key(s) to ${LOCALE_FILES.enUS}
`)
  process.exit(1)
}

const missingInZhCN = [...enUSKeys].filter((key) => !zhCNKeys.has(key))
const missingInEnUS = [...zhCNKeys].filter((key) => !enUSKeys.has(key))

if (missingInZhCN.length > 0 || missingInEnUS.length > 0) {
  console.error('\n❌ Locale key mismatch detected:\n')

  if (missingInZhCN.length > 0) {
    console.error(`Missing in ${LOCALE_FILES.zhCN}:`)
    for (const key of missingInZhCN) {
      console.error(`  ${key}`)
    }
    console.error('')
  }

  if (missingInEnUS.length > 0) {
    console.error(`Missing in ${LOCALE_FILES.enUS}:`)
    for (const key of missingInEnUS) {
      console.error(`  ${key}`)
    }
    console.error('')
  }

  console.error('How to fix:')
  console.error('  Keep en-US.json and zh-CN.json key sets identical.')
  process.exit(1)
}

console.log('✅ All t() keys exist and locale files are aligned.')
