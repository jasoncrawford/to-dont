import { defineConfig } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const VITE_PORT = 5173;
const SYNC_TEST_PORT = 3001;

// Load .env.local for sync-e2e tests (local Supabase)
function loadEnvFile(filename: string): Record<string, string> {
  try {
    const content = readFileSync(resolve(__dirname, filename), 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      env[key] = rest.join('=');
    }
    return env;
  } catch {
    return {};
  }
}

const testEnv = loadEnvFile('.env.local');

// Tests use the 'test' schema so dev data in 'public' survives test runs
testEnv.SUPABASE_SCHEMA = 'test';

// vercel dev only reads .env (ignores .env.local and process env for serverless
// functions), so we must write our test env vars there. Back up any existing
// .env first so it can be restored after the test run.
const dotenvPath = resolve(__dirname, '.env');
const dotenvBackup = resolve(__dirname, '.env.pre-test');
// Only create backup if one doesn't already exist (avoids poisoning the backup
// when a previous test run failed before teardown could restore)
if (existsSync(dotenvPath) && !existsSync(dotenvBackup)) {
  copyFileSync(dotenvPath, dotenvBackup);
}
const dotenvContent = Object.entries(testEnv)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n') + '\n';
writeFileSync(dotenvPath, dotenvContent);

export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/global-teardown.ts',
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
      command: `npx vite --port ${VITE_PORT}`,
      port: VITE_PORT,
      reuseExistingServer: false,
      env: testEnv,
    },
    {
      command: `npx vercel dev --listen ${SYNC_TEST_PORT} --yes`,
      port: SYNC_TEST_PORT,
      reuseExistingServer: false,
      env: testEnv,
    },
  ],
});
