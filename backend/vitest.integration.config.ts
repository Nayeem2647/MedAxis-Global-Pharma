import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.ts'],
    env: { NODE_ENV: 'test' },
    // Atlas migrations and multi-transaction scenarios include many remote round trips.
    // Keep these bounded without treating network latency as a business invariant.
    hookTimeout: 180_000,
    testTimeout: 90_000,
    fileParallelism: false,
  },
});
