/**
 * Integration tests for sync functionality.
 * Run with: npx ts-node tests/sync-integration.ts
 * Requires: vercel dev running on localhost:3000
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

const API_URL = 'http://localhost:3000';
const BEARER_TOKEN = process.env.SYNC_BEARER_TOKEN;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${BEARER_TOKEN}`,
    ...options.headers as Record<string, string>,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error });
    console.log(`✗ ${name}: ${error}`);
  }
}

async function runTests() {
  console.log('\n=== Sync Integration Tests ===\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`Bearer Token: ${BEARER_TOKEN ? 'SET' : 'NOT SET'}\n`);

  if (!BEARER_TOKEN) {
    console.error('ERROR: SYNC_BEARER_TOKEN not set in .env.local');
    process.exit(1);
  }

  // Test 1: Debug endpoint
  await test('Debug endpoint returns env status', async () => {
    const data = await apiRequest<{ SUPABASE_URL: boolean; SUPABASE_SERVICE_KEY: boolean }>('/api/debug');
    if (!data.SUPABASE_URL) throw new Error('SUPABASE_URL not set on server');
    if (!data.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY not set on server');
  });

  interface Item {
    id: string;
    text: string;
    important: boolean;
    [key: string]: unknown;
  }

  // Test 2: GET items (might be empty)
  let initialItems: Item[] = [];
  await test('GET /api/items returns array', async () => {
    const data = await apiRequest<Item[]>('/api/items');
    if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`);
    initialItems = data;
  });

  // Test 3: POST new item
  const testId = generateUUID();
  const testItem = {
    id: testId,
    type: 'todo',
    text: `Test item ${Date.now()}`,
    important: false,
    completed_at: null,
    created_at: new Date().toISOString(),
    sort_order: 0,
  };

  await test('POST /api/items creates item', async () => {
    const data = await apiRequest<Item>('/api/items', {
      method: 'POST',
      body: JSON.stringify(testItem),
    });
    if (!data.id) throw new Error('No id in response');
    if (data.id !== testId) throw new Error(`ID mismatch: ${data.id} !== ${testId}`);
  });

  // Test 4: GET items includes new item
  await test('GET /api/items includes new item', async () => {
    const data = await apiRequest<Item[]>('/api/items');
    const found = data.find((item) => item.id === testId);
    if (!found) throw new Error(`Item ${testId} not found in list`);
  });

  // Test 5: PATCH item
  await test('PATCH /api/items/:id updates item', async () => {
    const data = await apiRequest<Item>(`/api/items/${testId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Updated text', important: true }),
    });
    if (data.text !== 'Updated text') throw new Error(`Text not updated: ${data.text}`);
    if (data.important !== true) throw new Error(`Important not updated: ${data.important}`);
  });

  // Test 6: Verify update persisted
  await test('GET /api/items shows updated item', async () => {
    const data = await apiRequest<Item[]>('/api/items');
    const found = data.find((item) => item.id === testId);
    if (!found) throw new Error(`Item ${testId} not found`);
    if (found.text !== 'Updated text') throw new Error(`Text not persisted: ${found.text}`);
  });

  // Test 7: Sync endpoint
  await test('POST /api/sync upserts items', async () => {
    const syncItem = {
      id: generateUUID(),
      type: 'todo',
      text: 'Synced item',
      important: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      sort_order: 1,
    };

    const data = await apiRequest<{ items: Item[]; syncedAt: string }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ items: [syncItem] }),
    });

    if (!data.items) throw new Error('No items in sync response');
    if (!data.syncedAt) throw new Error('No syncedAt in sync response');
  });

  // Test 8: DELETE item
  await test('DELETE /api/items/:id removes item', async () => {
    await apiRequest(`/api/items/${testId}`, { method: 'DELETE' });

    // Verify deleted
    const data = await apiRequest<Item[]>('/api/items');
    const found = data.find((item) => item.id === testId);
    if (found) throw new Error(`Item ${testId} still exists after delete`);
  });

  // Test 9: Auth required
  await test('Requests without auth return 401', async () => {
    try {
      const response = await fetch(`${API_URL}/api/items`);
      if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        // Expected
      } else {
        throw err;
      }
    }
  });

  // Summary
  console.log('\n=== Summary ===\n');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
