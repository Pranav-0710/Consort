import { defineConfig } from 'vitest/config';

// Coordinator tests have their own config, so the Cloudflare Workers test pool
// (@cloudflare/vitest-pool-workers) can be added in #10 without touching the root config.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
