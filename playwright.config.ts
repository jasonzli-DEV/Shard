/**
 * Playwright configuration for Shard E2E tests.
 *
 * Servers are started in globalSetup (e2e/global-setup.ts):
 *   - MongoDB (mongodb-memory-server) on port 27099
 *   - Backend (Express, SHARD_E2E=1) on port 4001
 *   - Frontend (Vite preview) on port 5174
 *
 * No external services (Atlas, Google, GitHub) are ever hit.
 * OAuth is bypassed via the POST /api/e2e/login test-only endpoint
 * (only mounted when SHARD_E2E=1).
 */
import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
