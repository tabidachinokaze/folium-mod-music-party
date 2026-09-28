import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// vitest.config.ts
export default defineConfig({
  resolve: {
    alias: { '@party': fileURLToPath(new URL('./vendor/music-party/src', import.meta.url)) },
  },
  test: { include: ['tests/*.test.ts'] },
})
