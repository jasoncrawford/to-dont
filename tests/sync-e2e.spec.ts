import { test, expect, chromium, Browser, Page } from '@playwright/test';

/**
 * End-to-end sync test - verifies data syncs to database.
 * Requires: vercel dev running on localhost:3000
 *
 * Run with: npx playwright test tests/sync-e2e.spec.ts --headed
 */

const APP_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000';
const BEARER_TOKEN = '8f512bd8190c0501c6ec356f821fdd32eff914a7770bd9e13b96b10923bfdb65';

// Helper to call API directly
async function apiGet(endpoint: string) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
    },
  });
  if (!response.ok) throw new Error(`API ${endpoint} failed: ${response.status}`);
  return response.json();
}

async function apiDelete(endpoint: string) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
    },
  });
  return response.ok;
}

async function clearDatabase() {
  const items = await apiGet('/api/items');
  console.log(`Clearing ${items.length} items from database...`);
  for (const item of items) {
    await apiDelete(`/api/items/${item.id}`);
  }
  const remaining = await apiGet('/api/items');
  console.log(`Database now has ${remaining.length} items`);
}

test.describe('E2E Sync Diagnostic', () => {
  // Run sync tests serially - they share a database and can't run in parallel
  test.describe.configure({ mode: 'serial' });

  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test.beforeEach(async () => {
    // Clear database first
    await clearDatabase();

    // Create fresh page
    page = await browser.newPage();

    // Capture all console output
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Sync]') || text.includes('Error') || text.includes('error')) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    // Capture network errors
    page.on('requestfailed', request => {
      console.log(`[Network Fail] ${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
    });

    // Clear localStorage and load app
    await page.goto(APP_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Wait for sync to fully initialize (including fetchAndMergeTodos)
    const syncEnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          page.off('console', handler);
          resolve();
        }
      };
      page.on('console', handler);
    });

    // Also handle case where sync might fail or not be configured
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    await Promise.race([syncEnabledPromise, timeout]);
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('database starts empty after clear', async () => {
    const items = await apiGet('/api/items');
    expect(items.length).toBe(0);
  });

  test('sync auto-enables and saveTodos wrapper works', async () => {
    // Wait for sync to initialize
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => {
      return {
        isConfigured: window.ToDoSync?.isConfigured() || false,
        isEnabled: window.ToDoSync?.isEnabled() || false,
        saveTodosWrapped: typeof window._originalSaveTodos === 'function',
        config: window.ToDoSync?.getConfig() || {},
      };
    });

    console.log('Sync state:', JSON.stringify(state, null, 2));

    expect(state.isConfigured).toBe(true);
    expect(state.isEnabled).toBe(true);
    expect(state.saveTodosWrapped).toBe(true);
  });

  test('creating an item syncs to database', async () => {
    // Wait for sync to fully initialize
    await page.waitForTimeout(1000);

    // Verify sync is enabled
    const syncEnabled = await page.evaluate(() => window.ToDoSync?.isEnabled());
    console.log('Sync enabled:', syncEnabled);
    expect(syncEnabled).toBe(true);

    // Verify database is empty
    const beforeItems = await apiGet('/api/items');
    console.log('Items before:', beforeItems.length);
    expect(beforeItems.length).toBe(0);

    // Find and click the new item input
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();

    // Type a unique test item
    const testText = `E2E Sync Test ${Date.now()}`;
    console.log('Creating item:', testText);
    await input.pressSequentially(testText);
    await input.press('Enter');

    // Wait for item to appear in UI
    await page.waitForSelector(`.todo-item .text:text-is("${testText}")`);
    console.log('Item created in UI');

    // Wait for sync (debounce is 1 second)
    console.log('Waiting 3s for sync...');
    await page.waitForTimeout(3000);

    // Check localStorage to see what was saved
    const localData = await page.evaluate(() => {
      return {
        todos: localStorage.getItem('decay-todos'),
        idMapping: localStorage.getItem('decay-todos-id-mapping'),
        synced: localStorage.getItem('decay-todos-synced'),
      };
    });
    console.log('localStorage todos:', localData.todos);
    console.log('localStorage idMapping:', localData.idMapping);

    // Check database
    const afterItems = await apiGet('/api/items');
    console.log('Items after:', afterItems.length);
    console.log('Database items:', JSON.stringify(afterItems.map((i: { id: string; text: string }) => ({
      id: i.id.substring(0, 8),
      text: i.text
    })), null, 2));

    // Verify item is in database
    const found = afterItems.find((item: { text: string }) => item.text === testText);
    expect(found).toBeTruthy();
    if (found) {
      console.log('✓ Item synced successfully!');
    }
  });

  test('items sync between two browser contexts', async () => {
    // Wait for sync to initialize on page 1
    await page.waitForTimeout(1000);

    // Create context 2
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    page2.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Sync]')) {
        console.log(`[Page2 Console] ${text}`);
      }
    });

    try {
      // Load and clear page 2
      await page2.goto(APP_URL);
      await page2.evaluate(() => localStorage.clear());
      await page2.reload();
      await page2.waitForLoadState('domcontentloaded');
      await page2.waitForTimeout(1000);

      // Create item on page 1
      await page.waitForSelector('.new-item', { state: 'visible' });
      const testText = `Cross-browser Test ${Date.now()}`;
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially(testText);
      await input.press('Enter');
      await page.waitForSelector(`.todo-item .text:text-is("${testText}")`);
      console.log('Created item on page 1:', testText);

      // Wait for sync
      await page.waitForTimeout(3000);

      // Verify in database
      const dbItems = await apiGet('/api/items');
      console.log('Database has:', dbItems.length, 'items');
      const inDb = dbItems.find((i: { text: string }) => i.text === testText);
      expect(inDb).toBeTruthy();
      console.log('Item confirmed in database');

      // Refresh page 2 to load from server
      await page2.reload();
      await page2.waitForLoadState('domcontentloaded');
      await page2.waitForTimeout(2000);

      // Check page 2
      const page2Items = await page2.locator('.todo-item .text').allTextContents();
      console.log('Page 2 items:', page2Items);
      expect(page2Items).toContain(testText);
      console.log('✓ Item synced to page 2!');

    } finally {
      await context2.close();
    }
  });

  test('marking item important syncs to database', async () => {
    // Create an item
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const testText = `Important Test ${Date.now()}`;
    await input.pressSequentially(testText);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${testText}")`);

    // Click elsewhere to blur, then wait for sync
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(3000);

    // Mark as important by clicking the ! button
    const todo = page.locator(`.todo-item:has(.text:text-is("${testText}"))`);
    await todo.hover();
    await todo.locator('.important-btn').click();

    // Verify it's marked important in UI
    await expect(todo).toHaveClass(/important/);
    console.log('Marked important in UI');

    // Wait for sync (debounce is 2s)
    await page.waitForTimeout(3000);

    // Check database
    const dbItems = await apiGet('/api/items');
    const dbItem = dbItems.find((i: { text: string }) => i.text === testText);
    expect(dbItem).toBeTruthy();
    expect(dbItem.important).toBe(true);
    console.log('✓ Important flag synced to database');
  });

  test('deleting item syncs to database', async () => {
    // Create an item
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const testText = `Delete Test ${Date.now()}`;
    await input.pressSequentially(testText);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${testText}")`);

    // Click elsewhere to blur, then wait for sync
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(3000);

    // Verify it's in database
    let dbItems = await apiGet('/api/items');
    let dbItem = dbItems.find((i: { text: string }) => i.text === testText);
    expect(dbItem).toBeTruthy();
    console.log('Item in database before delete');

    // Delete the item
    const todo = page.locator(`.todo-item:has(.text:text-is("${testText}"))`);
    await todo.hover();
    await todo.locator('.actions button:has-text("×")').click();

    // Wait for it to disappear from UI
    await expect(page.locator(`.todo-item .text:text-is("${testText}")`)).toHaveCount(0);
    console.log('Deleted from UI');

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check database - item should be gone
    dbItems = await apiGet('/api/items');
    dbItem = dbItems.find((i: { text: string }) => i.text === testText);
    expect(dbItem).toBeFalsy();
    console.log('✓ Delete synced to database');
  });

  test('reordering items syncs to database', async () => {
    // Log console messages for debugging
    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create first item using new-item input
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const item1Text = `First ${Date.now()}`;
    await input.pressSequentially(item1Text);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${item1Text}")`);

    // Create second item
    const item2Text = `Second ${Date.now()}`;
    await page.locator('.todo-item .text').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type(item2Text);
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForSelector(`.todo-item .text:text-is("${item2Text}")`);

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Verify order in database: item1 should be before item2
    let dbItems = await apiGet('/api/items');
    const item1Before = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2Before = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('Before reorder - positions:', item1Before?.position, item2Before?.position);
    expect(item1Before.position < item2Before.position).toBe(true);

    // Reorder: move item2 up using keyboard
    await page.locator(`.todo-item .text:text-is("${item2Text}")`).click();
    await page.keyboard.press('Meta+Shift+ArrowUp');
    await page.waitForTimeout(100);

    // Verify UI order changed
    const texts = await page.locator('.todo-item .text').allTextContents();
    console.log('UI order after reorder:', texts);
    expect(texts[0]).toBe(item2Text);

    // Wait for sync (debounce is 2s, add buffer)
    await page.waitForTimeout(4000);

    // Check database order: item2 should now be before item1
    dbItems = await apiGet('/api/items');
    const item1After = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2After = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('After reorder - positions:', item1After?.position, item2After?.position);
    expect(item2After.position < item1After.position).toBe(true);
    console.log('✓ Reorder synced to database');
  });

  test('reorder after page refresh syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);
    // This tests reordering items that were loaded from server (not created fresh)
    // Log console messages for debugging
    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create items
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const item1Text = `RefreshFirst ${Date.now()}`;
    await input.pressSequentially(item1Text);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${item1Text}")`);

    const item2Text = `RefreshSecond ${Date.now()}`;
    await page.locator('.todo-item .text').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type(item2Text);
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForSelector(`.todo-item .text:text-is("${item2Text}")`);

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Verify items in database
    let dbItems = await apiGet('/api/items');
    const item1Before = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2Before = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('Initial positions:', item1Before?.position, item2Before?.position);
    expect(item1Before).toBeTruthy();
    expect(item2Before).toBeTruthy();

    // REFRESH THE PAGE to simulate loading from server
    console.log('Refreshing page...');
    await page.reload();

    // Wait for sync to initialize after refresh
    const syncEnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          page.off('console', handler);
          resolve();
        }
      };
      page.on('console', handler);
    });
    await Promise.race([
      syncEnabledPromise,
      page.waitForTimeout(10000)
    ]);

    // Wait for items to render
    await page.waitForSelector(`.todo-item .text:text-is("${item1Text}")`);
    await page.waitForSelector(`.todo-item .text:text-is("${item2Text}")`);

    // Verify UI order
    let texts = await page.locator('.todo-item .text').allTextContents();
    console.log('After refresh UI order:', texts);

    // NOW reorder: move item2 up
    await page.locator(`.todo-item .text:text-is("${item2Text}")`).click();
    await page.keyboard.press('Meta+Shift+ArrowUp');
    await page.waitForTimeout(100);

    // Verify UI order changed
    texts = await page.locator('.todo-item .text').allTextContents();
    console.log('After reorder UI order:', texts);
    expect(texts[0]).toBe(item2Text);

    // Wait for sync (debounce is 2s, add buffer)
    await page.waitForTimeout(4000);

    // Check database order: item2 should now be before item1
    dbItems = await apiGet('/api/items');
    const item1After = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2After = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('After reorder - positions:', item1After?.position, item2After?.position);
    expect(item2After.position < item1After.position).toBe(true);
    console.log('✓ Reorder after refresh synced to database');
  });

  test('drag-and-drop reorder syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    // Log console messages for debugging
    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create items
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const item1Text = `DragFirst ${Date.now()}`;
    await input.pressSequentially(item1Text);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${item1Text}")`);

    const item2Text = `DragSecond ${Date.now()}`;
    await page.locator('.todo-item .text').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type(item2Text);
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForSelector(`.todo-item .text:text-is("${item2Text}")`);

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Verify items in database
    let dbItems = await apiGet('/api/items');
    const item1Before = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2Before = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('Before drag - positions:', item1Before?.position, item2Before?.position);

    // Drag item2 above item1
    const item2Handle = page.locator(`.todo-item:has(.text:text-is("${item2Text}")) .drag-handle`);
    const item1 = page.locator(`.todo-item:has(.text:text-is("${item1Text}"))`);
    const item1Box = await item1.boundingBox();

    await item2Handle.hover();
    await page.mouse.down();
    await page.mouse.move(item1Box!.x + item1Box!.width / 2, item1Box!.y);
    await page.mouse.up();

    // Verify UI order changed
    await page.waitForTimeout(500);
    const texts = await page.locator('.todo-item .text').allTextContents();
    console.log('After drag UI order:', texts);
    expect(texts[0]).toBe(item2Text);

    // Wait for sync (debounce is 2s, add buffer)
    await page.waitForTimeout(4000);

    // Check database order
    dbItems = await apiGet('/api/items');
    const item1After = dbItems.find((i: { text: string }) => i.text === item1Text);
    const item2After = dbItems.find((i: { text: string }) => i.text === item2Text);
    console.log('After drag - positions:', item1After?.position, item2After?.position);
    expect(item2After.position < item1After.position).toBe(true);
    console.log('✓ Drag-and-drop reorder synced to database');
  });

  test('reorder in one browser syncs to another browser', async () => {
    // This test reproduces the bug:
    // 1. Browser1 adds items 1, 2, 3
    // 2. Browser2 loads and sees 1, 2, 3
    // 3. Browser2 reorders item 3 above item 2
    // 4. Browser1 should see 1, 3, 2 via realtime (no reload)

    // Create two browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const browser1 = await context1.newPage();
    const browser2 = await context2.newPage();

    // Set up console logging
    browser1.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log(`[Browser1] ${msg.text()}`);
      }
    });
    browser2.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log(`[Browser2] ${msg.text()}`);
      }
    });

    // Load app in browser1 and wait for full sync initialization
    await browser1.goto(APP_URL);

    // Create a promise that resolves when we see the "✓ Enabled" message
    const browser1EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser1.off('console', handler);
          resolve();
        }
      };
      browser1.on('console', handler);
    });

    // Wait for the actual "Enabled" message which means fetchAndMergeTodos completed
    await browser1EnabledPromise;
    console.log('Browser1 sync enabled');

    // Add Item 1
    await browser1.waitForSelector('.new-item', { state: 'visible' });
    await browser1.locator('.new-item .text').click();
    await browser1.keyboard.type('Item 1');
    await browser1.keyboard.press('Enter');
    await browser1.waitForSelector('.todo-item .text:text-is("Item 1")');

    // Add Item 2
    await browser1.locator('.todo-item .text:text-is("Item 1")').click();
    await browser1.keyboard.press('End');
    await browser1.keyboard.press('Enter');
    await browser1.waitForTimeout(100);
    await browser1.keyboard.type('Item 2');

    // Add Item 3
    await browser1.keyboard.press('Enter');
    await browser1.waitForTimeout(100);
    await browser1.keyboard.type('Item 3');
    await browser1.locator('body').click({ position: { x: 10, y: 10 } });
    await browser1.waitForSelector('.todo-item .text:text-is("Item 3")');
    console.log('Browser1 added all 3 items');

    // Wait for sync
    await browser1.waitForTimeout(3000);

    // Browser2 loads and should see all items
    await browser2.goto(APP_URL);

    // Wait for full sync initialization in browser2
    const browser2EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser2.off('console', handler);
          resolve();
        }
      };
      browser2.on('console', handler);
    });
    await browser2EnabledPromise;
    await browser2.waitForSelector('.todo-item .text:text-is("Item 3")', { timeout: 5000 });

    let browser2Texts = await browser2.locator('.todo-item .text').allTextContents();
    console.log('Browser2 initial:', browser2Texts);
    expect(browser2Texts).toEqual(['Item 1', 'Item 2', 'Item 3']);

    // Browser2 reorders: move Item 3 above Item 2
    await browser2.locator('.todo-item .text:text-is("Item 3")').click();
    await browser2.keyboard.press('Meta+Shift+ArrowUp');
    await browser2.waitForTimeout(100);

    browser2Texts = await browser2.locator('.todo-item .text').allTextContents();
    console.log('Browser2 after reorder:', browser2Texts);
    expect(browser2Texts).toEqual(['Item 1', 'Item 3', 'Item 2']);

    // Wait for Browser2's sync to complete (2s debounce + processing time)
    await browser2.waitForTimeout(4000);

    // Browser1 should see the new order via realtime update (NO RELOAD)
    const browser1Texts = await browser1.locator('.todo-item .text').allTextContents();
    console.log('Browser1 after realtime sync (no reload):', browser1Texts);

    // This assertion should FAIL before the fix is applied
    expect(browser1Texts).toEqual(['Item 1', 'Item 3', 'Item 2']);
    console.log('✓ Reorder synced between browsers via realtime!');

    // Cleanup
    await context1.close();
    await context2.close();
  });
});

// Type declarations
declare global {
  interface Window {
    ToDoSync?: {
      enable: () => Promise<boolean>;
      disable: () => void;
      isEnabled: () => boolean;
      isConfigured: () => boolean;
      refresh: () => Promise<void>;
      getConfig: () => Record<string, string>;
    };
    _originalSaveTodos?: (todos: unknown[]) => void;
  }
}
