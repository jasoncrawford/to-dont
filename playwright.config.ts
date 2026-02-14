import { defineConfig } from '@playwright/test';

const VITE_PORT = 8173;
const SYNC_TEST_PORT = 8174;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${VITE_PORT}`,
      },
      testIgnore: /sync-e2e/,
    },
    {
      name: 'sync-e2e-api',
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${SYNC_TEST_PORT}`,
      },
      testMatch: /events-api-sync-e2e/,
    },
    {
      name: 'sync-e2e',
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${SYNC_TEST_PORT}`,
      },
      testMatch: /sync-e2e/,
      testIgnore: /events-api/,
      dependencies: ['sync-e2e-api'],
    },
  ],
  webServer: [
    {
      command: `npx env-cmd -f .env.test npx vite --port ${VITE_PORT}`,
      port: VITE_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx env-cmd -f .env.test npx vercel dev --listen ${SYNC_TEST_PORT} --yes`,
      port: SYNC_TEST_PORT,
      reuseExistingServer: false,
    },
  ],
});
