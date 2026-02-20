import { defineConfig } from '@playwright/test';
import { readFileSync } from 'fs';

// Load .env.test so test files can access env vars (e.g. SYNC_BEARER_TOKEN)
for (const line of readFileSync('.env.test', 'utf-8').split('\n')) {
  const match = line.match(/^(\w+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2];
  }
}

const VITE_PORT = 8173;
const SYNC_TEST_PORT = 8174;
const VERCEL_TOKEN_FLAG = process.env.VERCEL_TOKEN ? ` --token=${process.env.VERCEL_TOKEN}` : '';

export default defineConfig({
  testDir: './tests',
  // In CI, put test artifacts outside the project dir so vercel dev's file
  // watcher doesn't crash when Playwright cleans up temp directories.
  ...(process.env.CI ? { outputDir: '/tmp/test-results' } : {}),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
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
      testIgnore: [/sync-e2e/, /unit\//],
    },
    {
      name: 'sync-e2e-api',
      fullyParallel: false,
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${SYNC_TEST_PORT}`,
      },
      testMatch: /events-api-sync-e2e/,
    },
    {
      name: 'sync-e2e',
      fullyParallel: false,
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
      command: `npx env-cmd -f .env.test npx vercel dev --listen ${SYNC_TEST_PORT} --yes${VERCEL_TOKEN_FLAG}`,
      port: SYNC_TEST_PORT,
      reuseExistingServer: false,
    },
  ],
});
