import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    globalSetup: process.env.VITEST_UNIT ? [] : ['./e2e/global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
    // Vitest 4 moved poolOptions to the top of `test`; previously `poolOptions.forks.singleFork`.
    forks: { singleFork: true },
  },
})
