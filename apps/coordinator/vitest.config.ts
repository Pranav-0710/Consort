import { defineConfig } from 'vitest/config';

// Coordinator tests run on Node against the StoragePort (src/db/sql.ts) backed by node:sqlite.
// The Cloudflare Workers pool is not used yet: its latest release (0.23.0) needs vitest 4 and
// this repo is on vitest 5. Nothing here runs in workerd.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
