import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'sse-consumer': resolve(__dirname, '../internal/sse-consumer/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', '../internal/sse-consumer/src/**/*.test.ts'],
  },
})
