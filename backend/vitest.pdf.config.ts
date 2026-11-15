import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pdf.render.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 45000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
