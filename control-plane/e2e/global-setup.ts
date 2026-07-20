import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupHarness, teardownHarness } from './harness'

// Runs once in the Vitest main process. Test workers are forked afterwards and
// inherit the environment set here, which is how they learn the run's service
// token without repeating the bootstrap.
//
// Vitest gives teardown no access to the run's results, so a failing test drops
// a marker file that teardown looks for to decide whether to capture
// diagnostics before cleaning up.

function markerPath(runId: string) {
  return join(tmpdir(), `e2e-failed-${runId}`)
}

export async function setup() {
  const harness = await setupHarness()

  process.env.E2E_RUN_ID = harness.runId
  process.env.E2E_RUN_TOKEN = harness.serviceToken
  process.env.E2E_RUN_BASE_URL = harness.profile.baseUrl
  process.env.E2E_FAILURE_MARKER = markerPath(harness.runId)

  rmSync(markerPath(harness.runId), { force: true })
}

export async function teardown() {
  const runId = process.env.E2E_RUN_ID
  // No run id means the bootstrap itself failed; treat that as a failure so
  // whatever it managed to create still gets reported.
  const failed = runId ? existsSync(markerPath(runId)) : true

  try {
    await teardownHarness(failed)
  } finally {
    if (runId) rmSync(markerPath(runId), { force: true })
  }
}
