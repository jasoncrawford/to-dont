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

  // ============================================
  // Section Sync Tests
  // ============================================

  test('creating a section syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create a todo first
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('Will become section');
    await input.press('Enter');
    await page.waitForSelector('.todo-item .text:text-is("Will become section")');

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Clear the text and press Enter to convert to section
    const todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');

    // Should now be a section
    await expect(page.locator('.section-header')).toHaveCount(1);
    await expect(page.locator('.todo-item')).toHaveCount(0);

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check database
    const dbItems = await apiGet('/api/items');
    console.log('Database items:', JSON.stringify(dbItems, null, 2));
    expect(dbItems.length).toBe(1);
    expect(dbItems[0].type).toBe('section');
    expect(dbItems[0].level).toBe(2); // Default level
    console.log('✓ Section synced to database');
  });

  test('promoting section to level 1 syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create a section
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await page.waitForSelector('.todo-item');

    const todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');
    await expect(page.locator('.section-header')).toHaveCount(1);

    // Give it a name
    const sectionText = page.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('My Section');
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Verify it's level 2 in database
    let dbItems = await apiGet('/api/items');
    expect(dbItems[0].level).toBe(2);
    console.log('Before promote - level:', dbItems[0].level);

    // Promote to level 1
    await sectionText.click();
    await sectionText.press('Shift+Tab');
    await expect(page.locator('.section-header')).toHaveClass(/level-1/);

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check database
    dbItems = await apiGet('/api/items');
    console.log('After promote - level:', dbItems[0].level);
    expect(dbItems[0].level).toBe(1);
    console.log('✓ Section promotion synced to database');
  });

  test('demoting section to level 2 syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create a section and promote it to level 1
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await page.waitForSelector('.todo-item');

    const todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');

    const sectionText = page.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('Level 1 Section');
    await sectionText.press('Shift+Tab'); // Promote to level 1
    await expect(page.locator('.section-header')).toHaveClass(/level-1/);
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for initial sync
    await page.waitForTimeout(3000);

    let dbItems = await apiGet('/api/items');
    expect(dbItems[0].level).toBe(1);
    console.log('Before demote - level:', dbItems[0].level);

    // Demote to level 2
    await sectionText.click();
    await sectionText.press('Tab');
    await expect(page.locator('.section-header')).toHaveClass(/level-2/);

    // Wait for sync
    await page.waitForTimeout(3000);

    dbItems = await apiGet('/api/items');
    console.log('After demote - level:', dbItems[0].level);
    expect(dbItems[0].level).toBe(2);
    console.log('✓ Section demotion synced to database');
  });

  test('reordering section with children syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create: Section A with item, then Section B with item
    // Structure: [Section A] [Item A1] [Section B] [Item B1]

    // Create Section A
    await page.waitForSelector('.new-item', { state: 'visible' });
    let input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await page.waitForSelector('.todo-item');
    let todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');
    let sectionText = page.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('Section A');
    await page.keyboard.press('Enter');

    // Add item under Section A
    await page.waitForTimeout(100);
    await page.keyboard.type('Item A1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Create Section B (by clearing the new empty item and pressing Enter)
    await page.keyboard.press('Enter'); // Creates empty item, which becomes section
    await page.waitForSelector('.section-header:nth-child(3)'); // Second section
    sectionText = page.locator('.section-header .text').last();
    await sectionText.click();
    await sectionText.pressSequentially('Section B');
    await page.keyboard.press('Enter');

    // Add item under Section B
    await page.waitForTimeout(100);
    await page.keyboard.type('Item B1');
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for sync
    await page.waitForTimeout(3000);

    // Get initial positions
    let dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('Initial order:', dbItems.map((i: { text: string }) => i.text));

    const sectionAPos = dbItems.find((i: { text: string }) => i.text === 'Section A')?.position;
    const sectionBPos = dbItems.find((i: { text: string }) => i.text === 'Section B')?.position;
    console.log('Before reorder - Section A pos:', sectionAPos, 'Section B pos:', sectionBPos);
    expect(sectionAPos < sectionBPos).toBe(true);

    // Move Section B up (should move with Item B1)
    sectionText = page.locator('.section-header .text:text-is("Section B")');
    await sectionText.click();
    await page.keyboard.press('Meta+Shift+ArrowUp');

    // Verify UI order changed
    await page.waitForTimeout(500);
    const allTexts = await page.locator('.section-header .text, .todo-item .text').allTextContents();
    console.log('UI order after reorder:', allTexts);
    expect(allTexts[0]).toBe('Section B');

    // Wait for sync
    await page.waitForTimeout(4000);

    // Check database order
    dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('After reorder:', dbItems.map((i: { text: string }) => i.text));

    const sectionAPosAfter = dbItems.find((i: { text: string }) => i.text === 'Section A')?.position;
    const sectionBPosAfter = dbItems.find((i: { text: string }) => i.text === 'Section B')?.position;
    console.log('After reorder - Section A pos:', sectionAPosAfter, 'Section B pos:', sectionBPosAfter);
    expect(sectionBPosAfter < sectionAPosAfter).toBe(true);
    console.log('✓ Section reorder with children synced to database');
  });

  test('level 1 section reorder moves entire group', async ({ }, testInfo) => {
    testInfo.setTimeout(90000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create two L1 sections by reusing the pattern from other tests
    // First: Section A (level 1)
    await page.waitForSelector('.new-item', { state: 'visible' });

    // Section A
    let input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await page.waitForSelector('.todo-item');
    let todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');
    let sectionText = page.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('Section A');
    await sectionText.press('Shift+Tab'); // Promote to L1
    await expect(page.locator('.section-header.level-1')).toHaveCount(1);

    // Add item by pressing Enter at end of section, then typing
    await sectionText.press('End');
    await sectionText.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type('Item under A');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Create Section B by clearing the new empty todo
    await page.keyboard.press('Enter'); // Creates empty item which becomes section
    await page.waitForTimeout(200);
    sectionText = page.locator('.section-header .text').last();
    await sectionText.click();
    await sectionText.pressSequentially('Section B');
    await sectionText.press('Shift+Tab'); // Promote to L1
    await expect(page.locator('.section-header.level-1')).toHaveCount(2);
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check what we have
    const allItems = await page.locator('.section-header .text, .todo-item .text').allTextContents();
    console.log('UI before reorder:', allItems);

    let dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('DB before:', dbItems.map((i: { text: string, type: string, level: number }) =>
      i.type === 'section' ? `[L${i.level}] ${i.text}` : i.text));

    // Move Section B up
    const sectionB = page.locator('.section-header .text:text-is("Section B")');
    await sectionB.click();
    await page.keyboard.press('Meta+Shift+ArrowUp');
    await page.waitForTimeout(500);

    const afterTexts = await page.locator('.section-header .text, .todo-item .text').allTextContents();
    console.log('UI after reorder:', afterTexts);

    // Section B should be first
    expect(afterTexts[0]).toBe('Section B');

    // Wait for sync
    await page.waitForTimeout(4000);

    dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('DB after:', dbItems.map((i: { text: string, type: string, level: number }) =>
      i.type === 'section' ? `[L${i.level}] ${i.text}` : i.text));

    const sectionBPos = dbItems.find((i: { text: string }) => i.text === 'Section B')?.position;
    const sectionAPos = dbItems.find((i: { text: string }) => i.text === 'Section A')?.position;
    console.log('Section B pos:', sectionBPos, 'Section A pos:', sectionAPos);
    expect(sectionBPos < sectionAPos).toBe(true);
    console.log('✓ Level 1 section reorder moves entire group');
  });

  test('section changes sync between browsers', async ({ }, testInfo) => {
    testInfo.setTimeout(90000);

    // Create two browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const browser1 = await context1.newPage();
    const browser2 = await context2.newPage();

    browser1.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser1]', msg.text());
      }
    });
    browser2.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser2]', msg.text());
      }
    });

    // Load and init browser1
    await browser1.goto(APP_URL);
    await browser1.evaluate(() => localStorage.clear());
    await browser1.reload();

    const browser1EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser1.off('console', handler);
          resolve();
        }
      };
      browser1.on('console', handler);
    });
    await Promise.race([browser1EnabledPromise, browser1.waitForTimeout(10000)]);
    console.log('Browser1 sync enabled');

    // Create a section in browser1
    await browser1.waitForSelector('.new-item', { state: 'visible' });
    const input = browser1.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await browser1.waitForSelector('.todo-item');
    const todoText = browser1.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await browser1.waitForTimeout(50);
    await todoText.press('Enter');
    const sectionText = browser1.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('Shared Section');
    await browser1.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for sync
    await browser1.waitForTimeout(3000);

    // Load browser2
    await browser2.goto(APP_URL);
    await browser2.evaluate(() => localStorage.clear());
    await browser2.reload();

    const browser2EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser2.off('console', handler);
          resolve();
        }
      };
      browser2.on('console', handler);
    });
    await Promise.race([browser2EnabledPromise, browser2.waitForTimeout(10000)]);

    // Browser2 should see the section
    await browser2.waitForSelector('.section-header .text:text-is("Shared Section")', { timeout: 5000 });
    console.log('Browser2 sees the section');

    // Promote section to level 1 in browser2
    const section2Text = browser2.locator('.section-header .text:text-is("Shared Section")');
    await section2Text.click();
    await section2Text.press('Shift+Tab');
    await expect(browser2.locator('.section-header')).toHaveClass(/level-1/);
    console.log('Browser2 promoted section to level 1');

    // Wait for sync and realtime
    await browser2.waitForTimeout(4000);

    // Browser1 should see level 1 via realtime
    await expect(browser1.locator('.section-header')).toHaveClass(/level-1/, { timeout: 5000 });
    console.log('✓ Section level change synced between browsers');

    await context1.close();
    await context2.close();
  });

  test('drag section header syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create two sections with items
    await page.waitForSelector('.new-item', { state: 'visible' });

    // Section A
    let input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('temp');
    await input.press('Enter');
    await page.waitForSelector('.todo-item');
    let todoText = page.locator('.todo-item .text').first();
    await todoText.click();
    await todoText.press('Meta+a');
    await todoText.press('Backspace');
    await page.waitForTimeout(50);
    await todoText.press('Enter');
    let sectionText = page.locator('.section-header .text').first();
    await sectionText.click();
    await sectionText.pressSequentially('Section A');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type('Item under A');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Section B (empty item becomes section)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    sectionText = page.locator('.section-header .text').last();
    await sectionText.click();
    await sectionText.pressSequentially('Section B');
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // Wait for sync
    await page.waitForTimeout(3000);

    let dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('Before drag:', dbItems.map((i: { text: string }) => i.text));

    const sectionAPos = dbItems.find((i: { text: string }) => i.text === 'Section A')?.position;
    const sectionBPos = dbItems.find((i: { text: string }) => i.text === 'Section B')?.position;
    expect(sectionAPos < sectionBPos).toBe(true);

    // Drag Section B above Section A
    const sectionBHandle = page.locator('.section-header:has(.text:text-is("Section B")) .drag-handle');
    const sectionA = page.locator('.section-header:has(.text:text-is("Section A"))');
    const sectionABox = await sectionA.boundingBox();

    await sectionBHandle.hover();
    await page.mouse.down();
    await page.mouse.move(sectionABox!.x + sectionABox!.width / 2, sectionABox!.y);
    await page.mouse.up();

    await page.waitForTimeout(500);
    const uiOrder = await page.locator('.section-header .text, .todo-item .text').allTextContents();
    console.log('UI after drag:', uiOrder);
    expect(uiOrder[0]).toBe('Section B');

    // Wait for sync
    await page.waitForTimeout(4000);

    dbItems = await apiGet('/api/items');
    dbItems.sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    console.log('After drag:', dbItems.map((i: { text: string }) => i.text));

    const sectionAPosAfter = dbItems.find((i: { text: string }) => i.text === 'Section A')?.position;
    const sectionBPosAfter = dbItems.find((i: { text: string }) => i.text === 'Section B')?.position;
    expect(sectionBPosAfter < sectionAPosAfter).toBe(true);
    console.log('✓ Drag section header synced to database');
  });

  // ============================================
  // Indentation Sync Tests
  // ============================================

  test('indenting a todo syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create a todo
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const todoText = `Indent Test ${Date.now()}`;
    await input.pressSequentially(todoText);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${todoText}")`);

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Check database - should NOT be indented
    let dbItems = await apiGet('/api/items');
    let item = dbItems.find((i: { text: string }) => i.text === todoText);
    console.log('Before indent - indented:', item?.indented);
    expect(item.indented).toBe(false);

    // Indent the todo with Tab
    const todo = page.locator(`.todo-item .text:text-is("${todoText}")`);
    await todo.click();
    await todo.press('Tab');

    // Verify UI shows indented
    await expect(page.locator('.todo-item.indented')).toHaveCount(1);
    console.log('UI shows indented');

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check database - should have indented = true
    dbItems = await apiGet('/api/items');
    item = dbItems.find((i: { text: string }) => i.text === todoText);
    console.log('After indent - indented:', item?.indented);
    expect(item.indented).toBe(true);
    console.log('✓ Indent synced to database');
  });

  test('unindenting a todo syncs to database', async ({ }, testInfo) => {
    testInfo.setTimeout(60000);

    page.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser]', msg.text());
      }
    });

    // Create a todo and indent it
    await page.waitForSelector('.new-item', { state: 'visible' });
    const input = page.locator('.new-item .text');
    await input.click();
    const todoText = `Unindent Test ${Date.now()}`;
    await input.pressSequentially(todoText);
    await input.press('Enter');
    await page.waitForSelector(`.todo-item .text:text-is("${todoText}")`);

    // Wait for initial creation sync
    await page.waitForTimeout(3000);

    // Indent
    const todo = page.locator(`.todo-item .text:text-is("${todoText}")`);
    await todo.click();
    await todo.press('Tab');
    await expect(page.locator('.todo-item.indented')).toHaveCount(1);

    // Wait for indent sync
    await page.waitForTimeout(3000);

    let dbItems = await apiGet('/api/items');
    let item = dbItems.find((i: { text: string }) => i.text === todoText);
    console.log('After indent - indented:', item?.indented);
    expect(item.indented).toBe(true);

    // Unindent with Shift+Tab
    await todo.click();
    await todo.press('Shift+Tab');
    await expect(page.locator('.todo-item.indented')).toHaveCount(0);
    console.log('UI shows unindented');

    // Wait for sync
    await page.waitForTimeout(3000);

    // Check database
    dbItems = await apiGet('/api/items');
    item = dbItems.find((i: { text: string }) => i.text === todoText);
    console.log('After unindent - indented:', item?.indented);
    expect(item.indented).toBe(false);
    console.log('✓ Unindent synced to database');
  });

  test('indentation syncs between browsers', async ({ }, testInfo) => {
    testInfo.setTimeout(90000);

    // Create two browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const browser1 = await context1.newPage();
    const browser2 = await context2.newPage();

    browser1.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser1]', msg.text());
      }
    });
    browser2.on('console', msg => {
      if (msg.text().includes('[Sync]')) {
        console.log('[Browser2]', msg.text());
      }
    });

    // Load and init browser1
    await browser1.goto(APP_URL);
    await browser1.evaluate(() => localStorage.clear());
    await browser1.reload();

    const browser1EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser1.off('console', handler);
          resolve();
        }
      };
      browser1.on('console', handler);
    });
    await Promise.race([browser1EnabledPromise, browser1.waitForTimeout(10000)]);
    console.log('Browser1 sync enabled');

    // Create a todo in browser1
    await browser1.waitForSelector('.new-item', { state: 'visible' });
    const input = browser1.locator('.new-item .text');
    await input.click();
    const todoText = `Cross-browser Indent ${Date.now()}`;
    await input.pressSequentially(todoText);
    await input.press('Enter');
    await browser1.waitForSelector(`.todo-item .text:text-is("${todoText}")`);

    // Wait for sync
    await browser1.waitForTimeout(3000);

    // Load browser2
    await browser2.goto(APP_URL);
    await browser2.evaluate(() => localStorage.clear());
    await browser2.reload();

    const browser2EnabledPromise = new Promise<void>(resolve => {
      const handler = (msg: { text: () => string }) => {
        if (msg.text().includes('[Sync] ✓ Enabled')) {
          browser2.off('console', handler);
          resolve();
        }
      };
      browser2.on('console', handler);
    });
    await Promise.race([browser2EnabledPromise, browser2.waitForTimeout(10000)]);

    // Browser2 should see the todo (not indented)
    await browser2.waitForSelector(`.todo-item .text:text-is("${todoText}")`, { timeout: 5000 });
    await expect(browser2.locator('.todo-item.indented')).toHaveCount(0);
    console.log('Browser2 sees the todo (not indented)');

    // Indent the todo in browser2
    const todo2 = browser2.locator(`.todo-item .text:text-is("${todoText}")`);
    await todo2.click();
    await todo2.press('Tab');
    await expect(browser2.locator('.todo-item.indented')).toHaveCount(1);
    console.log('Browser2 indented the todo');

    // Wait for sync and realtime
    await browser2.waitForTimeout(4000);

    // Browser1 should see indented via realtime
    await expect(browser1.locator('.todo-item.indented')).toHaveCount(1, { timeout: 5000 });
    console.log('✓ Indentation synced between browsers');

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
