#!/usr/bin/env node
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * Pre-bundle @excalidraw/excalidraw with esbuild into a self-contained ESM file
 * deployed to public/. React is injected via global variables so the bundle
 * shares the app's single React instance without any bare-specifier imports.
 *
 * This removes excalidraw from Rollup's dependency graph entirely — the main
 * Vite build never touches excalidraw code.
 */
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const outfile = resolve(here, '../public/excalidraw-assets/excalidraw.mjs')
const entry = resolve(here, '../node_modules/@excalidraw/excalidraw/dist/prod/index.js')

if (!existsSync(entry)) {
  console.warn('[prebundle] @excalidraw/excalidraw not installed, skipping')
  process.exit(0)
}

// Skip if output is newer than entry
if (existsSync(outfile) && statSync(outfile).mtimeMs >= statSync(entry).mtimeMs) {
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Generate React shim files that read from globalThis.__EXCALIDRAW_REACT__*
// ---------------------------------------------------------------------------
const shimDir = resolve(here, '../.prebundled')
mkdirSync(shimDir, { recursive: true })

function generateShim(globalName, modulePath) {
  const mod = require(modulePath)
  const keys = Object.keys(mod).filter((k) => k !== 'default' && k !== '__esModule')
  return [
    `const M = globalThis.${globalName};`,
    'export default M;',
    ...keys.map((k) => `export const ${k} = /* @__PURE__ */ M.${k};`),
  ].join('\n')
}

const shims = {
  react: { global: '__EXCALIDRAW_REACT__', mod: 'react' },
  'react-dom': { global: '__EXCALIDRAW_REACT_DOM__', mod: 'react-dom' },
  'react/jsx-runtime': { global: '__EXCALIDRAW_JSX_RUNTIME__', mod: 'react/jsx-runtime' },
}

const alias = {}
for (const [specifier, { global: g, mod }] of Object.entries(shims)) {
  const shimPath = resolve(shimDir, `${specifier.replace('/', '-')}-shim.mjs`)
  writeFileSync(shimPath, generateShim(g, mod))
  alias[specifier] = shimPath
}

// ---------------------------------------------------------------------------
// Bundle with esbuild
// ---------------------------------------------------------------------------
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  outfile,
  alias,
  minify: true,
  platform: 'browser',
  target: 'es2020',
  logLevel: 'warning',
  legalComments: 'none',
})

console.log(`[prebundle] excalidraw → ${outfile}`)
