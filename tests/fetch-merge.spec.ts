import { test, expect } from '@playwright/test';
import { setupPage, addTodo, getStoredTodos } from './helpers';

// These tests verify that fetchAndMergeTodos() merges server state with
// local state instead of overwriting it.

// Helper: build a server-format item (as returned by /api/items)
function makeServerItem(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'server-uuid-1',
    text: 'Server item',
    created_at: now,
    important: false,
    completed_at: null,
    type: 'todo',
    level: null,
    indented: false,
    position: 'N',
    text_updated_at: now,
    important_updated_at: now,
    completed_updated_at: now,
    position_updated_at: now,
    ...overrides,
  };
}

const FAKE_API = 'https://fake-sync-api.test';

// Set up the fake API URL and enable sync for testing fetchAndMergeTodos
async function enableSyncForTest(page: import('@playwright/test').Page) {
  await page.evaluate((apiUrl) => {
    (window as any).SYNC_API_URL = apiUrl;
    window.ToDoSync._test.setSyncEnabled(true);
  }, FAKE_API);
}

test.describe('fetchAndMergeTodos', () => {

  test('should preserve local items not on server', async ({ page }) => {
    await setupPage(page);

    // Add a local item
    await addTodo(page, 'Local only item');
    const storedBefore = await getStoredTodos(page);
    expect(storedBefore).toHaveLength(1);

    // Mock the /api/items endpoint to return an empty server
    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Enable sync and call fetchAndMergeTodos
    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    // The local item should still be there
    const storedAfter = await getStoredTodos(page);
    expect(storedAfter).toHaveLength(1);
    expect(storedAfter[0].text).toBe('Local only item');
  });

  test('should preserve local archived status when merging with server', async ({ page }) => {
    await setupPage(page);

    // Set up a local item that is archived, with a known UUID
    const uuid = 'test-uuid-archived';
    await page.evaluate((uuid) => {
      const item = {
        id: uuid,
        text: 'Archived item',
        createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        important: false,
        completed: true,
        completedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        archived: true,
        archivedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
        position: 'N',
        textUpdatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        importantUpdatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        completedUpdatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        positionUpdatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
      };
      localStorage.setItem('decay-todos', JSON.stringify([item]));
      // Set up ID mapping so findItemByUUID can find it
      const mapping: Record<string, string> = {};
      mapping[uuid] = uuid;
      localStorage.setItem('decay-todos-id-mapping', JSON.stringify(mapping));
    }, uuid);

    // Server returns the same item but without archived info (server doesn't store it)
    const serverItem = makeServerItem({
      id: uuid,
      text: 'Archived item',
      created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      completed_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([serverItem]),
      });
    });

    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    // archived and archivedAt should be preserved from local state
    expect(stored[0].archived).toBe(true);
    expect(stored[0].archivedAt).toBeTruthy();
  });

  test('should merge CRDT fields using LWW timestamps', async ({ page }) => {
    await setupPage(page);

    const uuid = 'test-uuid-crdt';
    const oldTime = Date.now() - 60000; // 1 minute ago
    const newTime = Date.now();

    // Local item has newer text but older important flag
    await page.evaluate(({ uuid, oldTime, newTime }) => {
      const item = {
        id: uuid,
        text: 'Local text wins',
        createdAt: oldTime,
        important: false,
        completed: false,
        position: 'N',
        textUpdatedAt: newTime,        // local text is newer
        importantUpdatedAt: oldTime,   // local important is older
        completedUpdatedAt: oldTime,
        positionUpdatedAt: oldTime,
      };
      localStorage.setItem('decay-todos', JSON.stringify([item]));
      const mapping: Record<string, string> = {};
      mapping[uuid] = uuid;
      localStorage.setItem('decay-todos-id-mapping', JSON.stringify(mapping));
    }, { uuid, oldTime, newTime });

    // Server has older text but newer important flag
    const serverItem = makeServerItem({
      id: uuid,
      text: 'Server text loses',
      important: true,
      text_updated_at: new Date(oldTime).toISOString(),       // server text is older
      important_updated_at: new Date(newTime).toISOString(),  // server important is newer
      completed_updated_at: new Date(oldTime).toISOString(),
      position_updated_at: new Date(oldTime).toISOString(),
    });

    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([serverItem]),
      });
    });

    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    // Text should come from local (newer timestamp)
    expect(stored[0].text).toBe('Local text wins');
    // Important should come from server (newer timestamp)
    expect(stored[0].important).toBe(true);
  });

  test('should add new server items not present locally', async ({ page }) => {
    await setupPage(page);

    // Start with one local item
    await addTodo(page, 'Existing local');
    const storedBefore = await getStoredTodos(page);
    expect(storedBefore).toHaveLength(1);

    // Server returns a new item
    const serverItem = makeServerItem({
      id: 'brand-new-server-item',
      text: 'New from server',
      position: 'Z',
    });

    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([serverItem]),
      });
    });

    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    const stored = await getStoredTodos(page);
    // Should have both local and server items
    expect(stored).toHaveLength(2);
    const texts = stored.map((t: { text: string }) => t.text);
    expect(texts).toContain('Existing local');
    expect(texts).toContain('New from server');
  });
});

// Extend the Window.ToDoSync type from sync.spec.ts with test internals
declare global {
  interface Window {
    ToDoSync: {
      _test: {
        setSyncEnabled: (val: boolean) => void;
      };
    };
  }
}
