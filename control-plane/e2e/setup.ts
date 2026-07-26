import { writeFileSync } from 'node:fs'
import { afterEach, describe } from 'vitest'
import { NapClient } from '../../internal/client/src'
import { loadProfile } from './config'

// Runs in every test worker. The harness itself lives in the Vitest main
// process (see ./global-setup.ts); workers only receive the run's identity
// through the environment and rebuild a client from it.

const baseUrl = process.env.E2E_RUN_BASE_URL
const serviceToken = process.env.E2E_RUN_TOKEN

if (!baseUrl || !serviceToken) {
  throw new Error(
    'E2E worker started without run credentials. These tests only run through the ' +
      'global setup — use `npm run test:e2e`, not a bare `vitest run e2e/…`.',
  )
}

/** Authenticated as the throwaway user this run provisioned. */
export const client = new NapClient({ baseUrl, serviceToken })

export const profile = loadProfile()

/** Identifier shared by every resource this run creates. */
export const RUN_ID = process.env.E2E_RUN_ID as string

/**
 * Namespace a resource name to this run. Leftovers stay attributable, and
 * concurrent runs against the same target cannot collide on names.
 */
export function scoped(name: string): string {
  return `e2e-${RUN_ID}-${name}`
}

// ---------------------------------------------------------------------------
// Capability gates
// ---------------------------------------------------------------------------
// Not every deployment has every component. A profile that declares a
// capability off skips the specs that need it instead of failing them.

/** Workspaces can reach `running` — needs a real Kubernetes-backed target. */
export const describeIfK8s = profile.capabilities.kubernetes ? describe : describe.skip

/** Agent cores this run exercises, from the profile. */
export const agentCores = profile.llm.agentTypes

/**
 * Run a suite once per configured agent core. This is the matrix knob: adding
 * a core to `llm.agentTypes` widens coverage without touching a spec. Skipped
 * wholesale when the target has no Kubernetes, since none of these can start a
 * workspace.
 */
export function describeEachCore(title: string, build: (agentType: string) => void): void {
  if (!profile.capabilities.kubernetes) {
    describe.skip(title, () => build(agentCores[0]))
    return
  }
  for (const core of agentCores) {
    describe(`${title} [${core}]`, () => build(core))
  }
}

// ---------------------------------------------------------------------------
// Failure marker
// ---------------------------------------------------------------------------
// Vitest hands globalSetup teardown no result summary, so record failures where
// the main process can find them. Diagnostics are captured before cleanup only
// when this marker exists.

afterEach((ctx) => {
  if (ctx.task.result?.state === 'fail' && process.env.E2E_FAILURE_MARKER) {
    try {
      writeFileSync(process.env.E2E_FAILURE_MARKER, `${ctx.task.name}\n`, { flag: 'a' })
    } catch {
      // best effort — a missing marker only costs us the diagnostics dump
    }
  }
})
