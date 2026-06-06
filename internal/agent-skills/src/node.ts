/**
 * Real DI implementations backed by Node.js fs / child_process.
 * Import this in agent code; never in tests.
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile, readFile, rm, readdir, rename } from 'node:fs/promises'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { Fs, Shell, Fetcher } from './index.ts'

const execFile = promisify(execFileCb)

export const nodeFs: Fs = {
  exists: existsSync,
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
  writeFile: (path, data) => writeFile(path, data),
  readFile: (path) => readFile(path),
  rm: (path) => rm(path, { recursive: true, force: true }),
  readdir: (path) => readdir(path),
  rename: (from, to) => rename(from, to),
}

export const nodeShell: Shell = {
  exec: (cmd, args) => execFile(cmd, args).then(() => {}),
}

export const nodeFetch: Fetcher = (url, init) => fetch(url, init)
