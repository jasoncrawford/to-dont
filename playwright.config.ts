import { defineConfig } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
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

// Generate sync-config.js so the browser connects to the same local Supabase as the API
writeFileSync(
  resolve(__dirname, 'sync-config.js'),
  `window.SYNC_CONFIG = ${JSON.stringify({
    supabaseUrl: testEnv.SUPABASE_URL || '',
    supabaseAnonKey: testEnv.SUPABASE_ANON_KEY || '',
    bearerToken: testEnv.SYNC_BEARER_TOKEN || '',
  }, null, 2)};`
);

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
      command: `npx vite --port ${VITE_PORT}`,
      port: VITE_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx vercel dev --listen ${SYNC_TEST_PORT} --yes`,
      port: SYNC_TEST_PORT,
      reuseExistingServer: false,
      env: testEnv,
    },
  ],
});
