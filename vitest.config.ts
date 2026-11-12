import { defineConfig } from 'vitest/config';

// Root tests only: repository-level checks such as workspace boundaries.
// Each workspace runs its own tests through its "test" script (root "npm test" runs both).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
