import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL } }],
  webServer: [
    { command: 'node --experimental-strip-types tests/e2e/mock-api.ts', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false },
    {
      command: process.env.E2E_PRODUCTION ? 'npm run start -- --hostname 127.0.0.1 --port 3100' : 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/en',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4100',
        API_INTERNAL_BASE_URL: 'http://127.0.0.1:4100',
        ADMIN_FRONTEND_ORIGIN: 'http://127.0.0.1:3100',
        NEXT_PUBLIC_SITE_URL: 'https://medaxisglobalpharma.com',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'frontend-browser-fixture-site-key',
        REVALIDATE_WEBHOOK_SECRET: 'medaxis-local-e2e-secret',
        NEXT_PUBLIC_PLAUSIBLE_DOMAIN: 'medaxisglobalpharma.com',
        NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL: 'https://plausible.example.test/js/pa-test.js',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
