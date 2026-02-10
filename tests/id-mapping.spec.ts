import { test, expect } from '@playwright/test';
import { setupPage, addTodo, getStoredTodos } from './helpers';

// These tests verify the serverUuid-on-item approach (replacing the old
// separate idMapping localStorage key).

const FAKE_API = 'https://fake-sync-api.test';

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
    type_updated_at: now,
    level_updated_at: now,
    indented_updated_at: now,
    ...overrides,
  };
}

// Set up the fake API URL and enable sync for testing
async function enableSyncForTest(page: import('@playwright/test').Page) {
  await page.evaluate((apiUrl) => {
    (window as any).SYNC_API_URL = apiUrl;
    window.ToDoSync._test.setSyncEnabled(true);
  }, FAKE_API);
}

test.describe('serverUuid on items', () => {

  test('serverUuid is stored on item after sync', async ({ page }) => {
    await setupPage(page);

    // Add a local item
    await addTodo(page, 'Sync me');
    const storedBefore = await getStoredTodos(page);
    expect(storedBefore).toHaveLength(1);
    expect(storedBefore[0].serverUuid).toBeUndefined();

    // Mock the sync endpoint to succeed
    await page.route('**/api/sync', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          mergedItems: [],
          deletedIds: [],
          syncedAt: new Date().toISOString(),
        }),
      });
    });

    // Mock items endpoint
    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Enable sync and trigger it
    await page.evaluate((apiUrl) => {
      (window as any).SYNC_API_URL = apiUrl;
      (window as any).SYNC_SUPABASE_URL = 'https://fake.supabase.co';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'fake-key';
      (window as any).SYNC_BEARER_TOKEN = 'fake-token';
      window.ToDoSync._test.setSyncEnabled(true);
    }, FAKE_API);

    await page.evaluate(() => window.ToDoSync._test.triggerSync());
    await page.waitForTimeout(500);

    // Check that serverUuid is now set on the item
    const storedAfter = await getStoredTodos(page);
    expect(storedAfter).toHaveLength(1);
    expect(storedAfter[0].serverUuid).toBeTruthy();
    // It should be a UUID-like string
    expect(storedAfter[0].serverUuid).toMatch(/^[0-9a-f-]+$/);
  });

  test('items survive localStorage mapping key deletion', async ({ page }) => {
    await setupPage(page);

    // Set up an item with serverUuid directly on it (new format)
    const uuid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    await page.evaluate((uuid) => {
      const item = {
        id: 'local-id-1',
        text: 'Item with serverUuid',
        createdAt: Date.now(),
        important: false,
        completed: false,
        position: 'N',
        serverUuid: uuid,
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
        completedUpdatedAt: Date.now(),
        positionUpdatedAt: Date.now(),
      };
      localStorage.setItem('decay-todos', JSON.stringify([item]));
      // Ensure old mapping key does NOT exist
      localStorage.removeItem('decay-todos-id-mapping');
    }, uuid);

    // Mock items endpoint returning same item from server
    const serverItem = makeServerItem({
      id: uuid,
      text: 'Item with serverUuid',
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

    // Should NOT create a duplicate - the item should be found via serverUuid
    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Item with serverUuid');
  });

  test('migration from old id-mapping format', async ({ page }) => {
    await setupPage(page);

    // Set up the OLD format: items without serverUuid, separate id-mapping key
    const localId = 'old-local-id';
    const uuid = 'migrated-uuid-1234-5678-abcdefabcdef';

    await page.evaluate(({ localId, uuid }) => {
      const item = {
        id: localId,
        text: 'Migrated item',
        createdAt: Date.now(),
        important: false,
        completed: false,
        position: 'N',
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
        completedUpdatedAt: Date.now(),
        positionUpdatedAt: Date.now(),
      };
      localStorage.setItem('decay-todos', JSON.stringify([item]));
      // Old-style mapping
      const mapping: Record<string, string> = {};
      mapping[localId] = uuid;
      localStorage.setItem('decay-todos-id-mapping', JSON.stringify(mapping));
    }, { localId, uuid });

    // Reload page to trigger migration in init()
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // After migration: serverUuid should be on the item, old mapping key should be gone
    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].serverUuid).toBe(uuid);
    expect(stored[0].id).toBe(localId);

    // Old mapping key should be removed
    const oldMapping = await page.evaluate(() => localStorage.getItem('decay-todos-id-mapping'));
    expect(oldMapping).toBeNull();
  });

  test('findItemByUUID matches by serverUuid property', async ({ page }) => {
    await setupPage(page);

    // Set up items with serverUuid
    const uuid1 = 'find-uuid-1111-2222-3333-444444444444';
    const uuid2 = 'find-uuid-5555-6666-7777-888888888888';

    await page.evaluate(({ uuid1, uuid2 }) => {
      const items = [
        {
          id: 'local-1',
          text: 'First item',
          createdAt: Date.now(),
          important: false,
          completed: false,
          position: 'f',
          serverUuid: uuid1,
          textUpdatedAt: Date.now(),
          importantUpdatedAt: Date.now(),
          completedUpdatedAt: Date.now(),
          positionUpdatedAt: Date.now(),
        },
        {
          id: 'local-2',
          text: 'Second item',
          createdAt: Date.now(),
          important: false,
          completed: false,
          position: 'n',
          serverUuid: uuid2,
          textUpdatedAt: Date.now(),
          importantUpdatedAt: Date.now(),
          completedUpdatedAt: Date.now(),
          positionUpdatedAt: Date.now(),
        },
      ];
      localStorage.setItem('decay-todos', JSON.stringify(items));
    }, { uuid1, uuid2 });

    // Mock items endpoint returning both items by their UUIDs
    const serverItem1 = makeServerItem({ id: uuid1, text: 'First item updated', position: 'f' });
    const serverItem2 = makeServerItem({ id: uuid2, text: 'Second item', position: 'n' });

    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([serverItem1, serverItem2]),
      });
    });

    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    // Items should be matched by serverUuid and merged (not duplicated)
    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(2);
    // Local IDs should be preserved
    expect(stored.find((t: { id: string }) => t.id === 'local-1')).toBeTruthy();
    expect(stored.find((t: { id: string }) => t.id === 'local-2')).toBeTruthy();
  });

  test('toDbFormat uses serverUuid from item when present', async ({ page }) => {
    await setupPage(page);

    // Set up an item that already has a serverUuid
    const existingUuid = 'existing-uuid-aaaa-bbbb-cccccccccccc';

    await page.evaluate((uuid) => {
      const item = {
        id: 'local-with-uuid',
        text: 'Has UUID already',
        createdAt: Date.now(),
        important: false,
        completed: false,
        position: 'N',
        serverUuid: uuid,
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
        completedUpdatedAt: Date.now(),
        positionUpdatedAt: Date.now(),
        typeUpdatedAt: Date.now(),
        levelUpdatedAt: Date.now(),
        indentedUpdatedAt: Date.now(),
      };
      localStorage.setItem('decay-todos', JSON.stringify([item]));
    }, existingUuid);

    // Track what UUID is sent to the server
    let sentUuid: string | null = null;

    await page.route('**/api/sync', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.items && body.items.length > 0) {
        sentUuid = body.items[0].id;
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          mergedItems: [],
          deletedIds: [],
          syncedAt: new Date().toISOString(),
        }),
      });
    });

    await page.evaluate((apiUrl) => {
      (window as any).SYNC_API_URL = apiUrl;
      (window as any).SYNC_SUPABASE_URL = 'https://fake.supabase.co';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'fake-key';
      (window as any).SYNC_BEARER_TOKEN = 'fake-token';
      window.ToDoSync._test.setSyncEnabled(true);
    }, FAKE_API);

    await page.evaluate(() => window.ToDoSync._test.triggerSync());
    await page.waitForTimeout(500);

    // The UUID sent to the server should be the existing one, not a newly generated one
    expect(sentUuid).toBe(existingUuid);
  });

  test('new items get serverUuid assigned on first sync', async ({ page }) => {
    await setupPage(page);

    // Add a new item (no serverUuid)
    await addTodo(page, 'Brand new item');

    const storedBefore = await getStoredTodos(page);
    expect(storedBefore).toHaveLength(1);
    expect(storedBefore[0].serverUuid).toBeUndefined();

    // Track what UUID is sent
    let sentUuid: string | null = null;

    await page.route('**/api/sync', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.items && body.items.length > 0) {
        sentUuid = body.items[0].id;
      }
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          mergedItems: [],
          deletedIds: [],
          syncedAt: new Date().toISOString(),
        }),
      });
    });

    await page.evaluate((apiUrl) => {
      (window as any).SYNC_API_URL = apiUrl;
      (window as any).SYNC_SUPABASE_URL = 'https://fake.supabase.co';
      (window as any).SYNC_SUPABASE_ANON_KEY = 'fake-key';
      (window as any).SYNC_BEARER_TOKEN = 'fake-token';
      window.ToDoSync._test.setSyncEnabled(true);
    }, FAKE_API);

    await page.evaluate(() => window.ToDoSync._test.triggerSync());
    await page.waitForTimeout(500);

    // The item should now have a serverUuid
    const storedAfter = await getStoredTodos(page);
    expect(storedAfter).toHaveLength(1);
    expect(storedAfter[0].serverUuid).toBeTruthy();
    // And the UUID sent to server should match what's stored on the item
    expect(storedAfter[0].serverUuid).toBe(sentUuid);
  });

  test('reverse lookup works with serverUuid on items', async ({ page }) => {
    await setupPage(page);

    // Set up many items, each with a serverUuid
    const items = [];
    for (let i = 0; i < 20; i++) {
      items.push({
        id: `local-${i}`,
        text: `Item ${i}`,
        createdAt: Date.now() - i * 1000,
        important: false,
        completed: false,
        position: String.fromCharCode(65 + i), // A, B, C, ...
        serverUuid: `uuid-${i.toString().padStart(4, '0')}-0000-0000-000000000000`,
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
        completedUpdatedAt: Date.now(),
        positionUpdatedAt: Date.now(),
      });
    }

    await page.evaluate((items) => {
      localStorage.setItem('decay-todos', JSON.stringify(items));
    }, items);

    // Server returns item #15 with updated text
    const targetUuid = 'uuid-0015-0000-0000-000000000000';
    const serverItems = [makeServerItem({
      id: targetUuid,
      text: 'Updated item 15',
      position: String.fromCharCode(65 + 15),
    })];

    await page.route('**/api/items', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverItems),
      });
    });

    await enableSyncForTest(page);
    await page.evaluate(() => window.ToDoSync.refresh());

    // The item should be matched correctly via serverUuid (not duplicated)
    const stored = await getStoredTodos(page);
    // All 20 local items + no duplicates from the 1 server item
    expect(stored).toHaveLength(20);
    // Item 15 should have its local ID preserved
    const item15 = stored.find((t: { id: string }) => t.id === 'local-15');
    expect(item15).toBeTruthy();
    // Its serverUuid should still match
    expect(item15.serverUuid).toBe(targetUuid);
  });
});

// Type declarations for test
declare global {
  interface Window {
    ToDoSync: {
      _test: {
        setSyncEnabled: (val: boolean) => void;
        triggerSync: () => Promise<void>;
      };
      refresh: () => Promise<void>;
    };
  }
}
