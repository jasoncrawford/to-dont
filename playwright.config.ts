import { defineConfig } from '@playwright/test';

const SYNC_TEST_PORT = 3001;

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
        baseURL: `file://${process.cwd()}/index.html`,
      },
      testIgnore: /sync-e2e/,
    },
    {
      name: 'sync-e2e',
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${SYNC_TEST_PORT}`,
      },
      testMatch: /sync-e2e/,
    },
  ],
  webServer: {
    command: `npx vercel dev --listen ${SYNC_TEST_PORT} --yes`,
    port: SYNC_TEST_PORT,
    reuseExistingServer: false,
  },
});
