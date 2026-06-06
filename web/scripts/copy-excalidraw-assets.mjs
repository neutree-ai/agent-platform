#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const excalidrawDist = resolve(here, '../node_modules/@excalidraw/excalidraw/dist/prod')
const dst = resolve(here, '../public/excalidraw-assets')

if (!existsSync(excalidrawDist)) {
  console.warn(`[excalidraw-assets] source not found: ${excalidrawDist} (did you run install?)`)
  process.exit(0)
}

// Copy fonts
const fontsSrc = resolve(excalidrawDist, 'fonts')
const fontsDst = resolve(dst, 'fonts')
if (!existsSync(fontsDst) || statSync(fontsDst).mtimeMs < statSync(fontsSrc).mtimeMs) {
  cpSync(fontsSrc, fontsDst, { recursive: true })
  console.log(`[excalidraw-assets] copied fonts → ${fontsDst}`)
}

// Copy CSS
const cssSrc = resolve(excalidrawDist, 'index.css')
const cssDst = resolve(dst, 'excalidraw.css')
if (!existsSync(cssDst) || statSync(cssDst).mtimeMs < statSync(cssSrc).mtimeMs) {
  copyFileSync(cssSrc, cssDst)
  console.log(`[excalidraw-assets] copied CSS → ${cssDst}`)
}
