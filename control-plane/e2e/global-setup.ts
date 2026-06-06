import type { ChildProcess } from 'node:child_process'
import {
  closePool,
  createTestDatabase,
  dropTestDatabase,
  runMigrations,
  seedTestUser,
  startCp,
  stopCp,
} from './helpers'

let cpProc: ChildProcess | undefined

export async function setup() {
  await createTestDatabase()
  await runMigrations()
  await seedTestUser()
  cpProc = await startCp()
}

export async function teardown() {
  if (cpProc) await stopCp(cpProc)
  await closePool()
  await dropTestDatabase()
}
