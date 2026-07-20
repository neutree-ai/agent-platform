import { defineConfig } from 'vitest/config'

// Unit tests only. The e2e suite runs against a deployed control plane and has
// its own config (vitest.e2e.config.ts) so that a bare `vitest` can never
// reach out to a cluster by accident.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
