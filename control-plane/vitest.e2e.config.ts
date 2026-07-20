import { defineConfig } from 'vitest/config'

// End-to-end suite. Drives a DEPLOYED control plane over HTTP — see e2e/README.md
// for the profile it needs. Serial by design: the specs walk a resource through
// create → mutate → delete across test() blocks, and the target is shared.
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    globalSetup: ['./e2e/global-setup.ts'],
    setupFiles: ['./e2e/setup.ts'],
    // Agent startup and real model round-trips dominate; these are generous on
    // purpose so a slow cluster reports a failure rather than a timeout.
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    pool: 'forks',
    // Vitest 4 moved poolOptions to the top of `test`; previously `poolOptions.forks.singleFork`.
    forks: { singleFork: true },
  },
})
