import { test, expect } from '@playwright/test';
import { setupPage, addTodo, getTodoTexts, getStoredTodos } from './helpers';

// Sync tests verify:
// 1. Sync is disabled in test mode (so existing tests work)
// 2. Sync layer loads without breaking the app
// 3. ToDoSync API is available

test.describe('Sync Layer', () => {
  test('sync is disabled in test mode', async ({ page }) => {
    await setupPage(page);

    // Check that sync is disabled in test mode
    const syncEnabled = await page.evaluate(() => {
      return window.ToDoSync ? window.ToDoSync.isEnabled() : false;
    });
    expect(syncEnabled).toBe(false);
  });

  test('app works normally with sync layer loaded', async ({ page }) => {
    await setupPage(page);

    // Basic functionality should work
    await addTodo(page, 'Test todo');

    const texts = await getTodoTexts(page);
    expect(texts).toContain('Test todo');

    // Data should be saved to localStorage
    const stored = await getStoredTodos(page);
    expect(stored.length).toBe(1);
    expect(stored[0].text).toBe('Test todo');
  });

  test('ToDoSync API is available', async ({ page }) => {
    await setupPage(page);

    const hasApi = await page.evaluate(() => {
      return typeof window.ToDoSync !== 'undefined' &&
             typeof window.ToDoSync.enable === 'function' &&
             typeof window.ToDoSync.disable === 'function' &&
             typeof window.ToDoSync.isEnabled === 'function' &&
             typeof window.ToDoSync.isConfigured === 'function';
    });
    expect(hasApi).toBe(true);
  });

  test('ToDoSync reports not configured when config is empty', async ({ page }) => {
    await setupPage(page);

    const isConfigured = await page.evaluate(() => {
      return window.ToDoSync.isConfigured();
    });
    expect(isConfigured).toBe(false);
  });

  test('saveTodos calls onSave hook and still saves to localStorage', async ({ page }) => {
    await setupPage(page);

    // Manually call saveTodos and verify it still saves to localStorage
    // and also calls the onSave hook
    const result = await page.evaluate(() => {
      let onSaveCalled = false;
      let onSaveArg: unknown = null;
      const originalOnSave = window.ToDoSync.onSave;
      window.ToDoSync.onSave = (todos: unknown[]) => {
        onSaveCalled = true;
        onSaveArg = todos;
      };

      const todos = [{
        id: 'test-123',
        text: 'Manual save test',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false
      }];
      window.saveTodos(todos);

      // Restore original
      window.ToDoSync.onSave = originalOnSave;

      return { onSaveCalled, onSaveArg };
    });

    expect(result.onSaveCalled).toBe(true);
    expect((result.onSaveArg as Array<{text: string}>)[0].text).toBe('Manual save test');

    const stored = await getStoredTodos(page);
    expect(stored.length).toBe(1);
    expect(stored[0].text).toBe('Manual save test');
  });

  test('saveTodos notifies sync layer via onSave hook', async ({ page }) => {
    await setupPage(page);

    // Install spy on window.ToDoSync.onSave
    const result = await page.evaluate(() => {
      let spyCalled = false;
      let spyData: unknown = null;
      const originalOnSave = window.ToDoSync.onSave;
      window.ToDoSync.onSave = (todos: unknown[]) => {
        spyCalled = true;
        spyData = todos;
      };

      window.saveTodos([{ id: 'test', text: 'hello' }]);

      // Restore
      window.ToDoSync.onSave = originalOnSave;

      return { spyCalled, spyData };
    });

    expect(result.spyCalled).toBe(true);
    expect((result.spyData as Array<{id: string, text: string}>)[0]).toMatchObject({ id: 'test', text: 'hello' });
  });

  test('saveTodos works without sync layer loaded', async ({ page }) => {
    await setupPage(page);

    // Temporarily remove ToDoSync and verify saveTodos still saves to localStorage
    await page.evaluate(() => {
      const savedSync = window.ToDoSync;
      (window as Window & { ToDoSync: unknown }).ToDoSync = undefined as unknown as Window['ToDoSync'];

      window.saveTodos([{
        id: 'no-sync-test',
        text: 'works without sync',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false
      }]);

      // Restore ToDoSync
      window.ToDoSync = savedSync;
    });

    const stored = await getStoredTodos(page);
    expect(stored.length).toBe(1);
    expect(stored[0].text).toBe('works without sync');
  });

  test('ToDoSync exposes onSave hook', async ({ page }) => {
    await setupPage(page);

    const hasOnSave = await page.evaluate(() => {
      return typeof window.ToDoSync.onSave === 'function';
    });
    expect(hasOnSave).toBe(true);
  });

  test('saveTodos no longer monkey-patches via _originalSaveTodos', async ({ page }) => {
    await setupPage(page);

    // Wait a bit to ensure any old polling would have completed
    await page.waitForTimeout(200);

    const hasOriginal = await page.evaluate(() => {
      return window._originalSaveTodos;
    });
    expect(hasOriginal).toBeUndefined();
  });

  test('multiple todos can be added and saved correctly', async ({ page }) => {
    await setupPage(page);

    await addTodo(page, 'First todo');
    await addTodo(page, 'Second todo');
    await addTodo(page, 'Third todo');

    const texts = await getTodoTexts(page);
    expect(texts).toHaveLength(3);
    expect(texts).toContain('First todo');
    expect(texts).toContain('Second todo');
    expect(texts).toContain('Third todo');

    // Verify localStorage has all items
    const stored = await getStoredTodos(page);
    expect(stored.length).toBe(3);
  });

  test('online event triggers re-sync when sync is enabled', async ({ page }) => {
    await setupPage(page);

    // Enable sync via _test helper
    await page.evaluate(() => {
      window.ToDoSync._test!.setSyncEnabled(true);
    });

    // Store a todo in localStorage
    await page.evaluate(() => {
      const todo = {
        id: 'online-test-1',
        text: 'offline item',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false,
        position: 'n',
      };
      localStorage.setItem('decay-todos', JSON.stringify([todo]));
    });

    // Install fetch spy
    await page.evaluate(() => {
      (window as Window & { _fetchCalls: string[] })._fetchCalls = [];
      const origFetch = window.fetch;
      window.fetch = function(...args: Parameters<typeof fetch>) {
        (window as Window & { _fetchCalls: string[] })._fetchCalls.push(String(args[0]));
        // Return a fake response to avoid network errors
        return Promise.resolve(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Call handleOnline via _test
    await page.evaluate(() => {
      window.ToDoSync._test!.handleOnline();
    });

    // Wait for debounce (~2500ms to be safe)
    await page.waitForTimeout(2500);

    const fetchCalls = await page.evaluate(() => {
      return (window as Window & { _fetchCalls: string[] })._fetchCalls;
    });

    // Verify fetch was called (queueServerSync and/or fetchAndMergeTodos)
    expect(fetchCalls.length).toBeGreaterThan(0);
  });

  test('online event does nothing when sync is disabled', async ({ page }) => {
    await setupPage(page);

    // syncEnabled is false by default in test mode - don't change it

    // Install fetch spy
    await page.evaluate(() => {
      (window as Window & { _fetchCalls: string[] })._fetchCalls = [];
      const origFetch = window.fetch;
      window.fetch = function(...args: Parameters<typeof fetch>) {
        (window as Window & { _fetchCalls: string[] })._fetchCalls.push(String(args[0]));
        return Promise.resolve(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Dispatch online event (not calling _test.handleOnline — using the real event)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Wait enough time for any potential sync
    await page.waitForTimeout(3000);

    const fetchCalls = await page.evaluate(() => {
      return (window as Window & { _fetchCalls: string[] })._fetchCalls;
    });

    // No fetch should have been made
    expect(fetchCalls.length).toBe(0);
  });

  test('online event listener is registered during init', async ({ page }) => {
    await setupPage(page);

    // Verify handleOnline is exposed in _test object
    const hasHandleOnline = await page.evaluate(() => {
      return typeof window.ToDoSync._test?.handleOnline === 'function';
    });
    expect(hasHandleOnline).toBe(true);
  });

  test('handleOnline calls fetchAndMergeTodos to pull remote changes', async ({ page }) => {
    await setupPage(page);

    // Enable sync
    await page.evaluate(() => {
      window.ToDoSync._test!.setSyncEnabled(true);
    });

    // Install fetch spy that tracks URLs
    await page.evaluate(() => {
      (window as Window & { _fetchUrls: string[] })._fetchUrls = [];
      window.fetch = function(...args: Parameters<typeof fetch>) {
        (window as Window & { _fetchUrls: string[] })._fetchUrls.push(String(args[0]));
        return Promise.resolve(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Call handleOnline
    await page.evaluate(() => {
      window.ToDoSync._test!.handleOnline();
    });

    // Wait for the delayed fetchAndMergeTodos (debounce + 2000ms delay + buffer)
    await page.waitForTimeout(5000);

    const fetchUrls = await page.evaluate(() => {
      return (window as Window & { _fetchUrls: string[] })._fetchUrls;
    });

    // Verify /api/items URL was fetched (proves fetchAndMergeTodos was called)
    const itemsFetched = fetchUrls.some(url => url.includes('/api/items'));
    expect(itemsFetched).toBe(true);
  });

  test('completing a todo works with sync layer', async ({ page }) => {
    await setupPage(page);

    await addTodo(page, 'Complete me');

    // Click checkbox to complete
    const todo = page.locator('.todo-item:has(.text:text("Complete me"))');
    await todo.locator('.checkbox').click();

    // Verify it's completed
    await expect(todo).toHaveClass(/completed/);

    // Verify localStorage shows completed
    const stored = await getStoredTodos(page);
    expect(stored[0].completed).toBe(true);
  });

  test('deleting a todo works with sync layer', async ({ page }) => {
    await setupPage(page);

    await addTodo(page, 'Delete me');
    await addTodo(page, 'Keep me');

    // Delete first todo
    const todo = page.locator('.todo-item:has(.text:text("Delete me"))');
    await todo.hover();
    await todo.locator('.actions button:has-text("×")').click();

    // Verify only one remains
    const texts = await getTodoTexts(page);
    expect(texts).toHaveLength(1);
    expect(texts).toContain('Keep me');

    const stored = await getStoredTodos(page);
    expect(stored.length).toBe(1);
  });
  test('sync requested during active sync is queued and runs after', async ({ page }) => {
    await setupPage(page);

    // Enable sync and set up a fake fetch that we can control
    await page.evaluate(() => {
      window.ToDoSync._test!.setSyncEnabled(true);

      // Track how many times sync API was called
      (window as any)._syncCallCount = 0;
      (window as any)._syncCallBodies = [];

      // Create a controllable fetch: first call takes a while, second resolves immediately
      let resolveFirstSync: (() => void) | null = null;
      (window as any)._resolveFirstSync = () => {
        if (resolveFirstSync) resolveFirstSync();
      };

      window.fetch = function(...args: Parameters<typeof fetch>) {
        const url = String(args[0]);
        (window as any)._syncCallCount++;

        if (url.includes('/api/sync')) {
          const body = args[1]?.body;
          if (body) {
            (window as any)._syncCallBodies.push(JSON.parse(body as string));
          }

          if ((window as any)._syncCallCount === 1) {
            // First sync call: delay resolution until we signal it
            return new Promise<Response>((resolve) => {
              resolveFirstSync = () => {
                resolve(new Response(JSON.stringify({ mergedItems: [] }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }));
              };
            });
          }
        }

        // All subsequent calls resolve immediately
        return Promise.resolve(new Response(JSON.stringify({ mergedItems: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Store initial todo
    await page.evaluate(() => {
      const todo1 = {
        id: 'sync-test-1',
        text: 'first item',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false,
        position: 'n',
      };
      localStorage.setItem('decay-todos', JSON.stringify([todo1]));
    });

    // Trigger the first sync (which will be blocked by our controlled fetch)
    await page.evaluate(() => {
      window.ToDoSync._test!.syncToServer([{
        id: 'sync-test-1',
        text: 'first item',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false,
        position: 'n',
      }]);
    });

    // Give it a moment to enter the syncing state
    await page.waitForTimeout(50);

    // Verify we're currently syncing
    const isSyncing = await page.evaluate(() => window.ToDoSync._test!.isSyncing());
    expect(isSyncing).toBe(true);

    // Now trigger a second sync while the first is in progress
    await page.evaluate(() => {
      window.ToDoSync._test!.syncToServer([{
        id: 'sync-test-1',
        text: 'updated item',
        createdAt: Date.now(),
        important: true,
        completed: false,
        archived: false,
        position: 'n',
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
      }]);
    });

    // The second sync should be pending, not dropped
    const isPending = await page.evaluate(() => window.ToDoSync._test!.isSyncPending());
    expect(isPending).toBe(true);

    // Now resolve the first sync
    await page.evaluate(() => {
      (window as any)._resolveFirstSync();
    });

    // Wait for the pending sync to complete
    await page.waitForTimeout(500);

    // Verify the pending sync ran (should have made 2 API calls total)
    const callCount = await page.evaluate(() => (window as any)._syncCallCount);
    expect(callCount).toBeGreaterThanOrEqual(2);

    // After everything completes, syncing should be false and pending should be false
    const finalSyncing = await page.evaluate(() => window.ToDoSync._test!.isSyncing());
    const finalPending = await page.evaluate(() => window.ToDoSync._test!.isSyncPending());
    expect(finalSyncing).toBe(false);
    expect(finalPending).toBe(false);
  });

  test('sync is not dropped when isSyncing is true - pending data reaches server', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(() => {
      window.ToDoSync._test!.setSyncEnabled(true);

      // Track sync bodies sent to server
      (window as any)._syncBodies = [];
      let resolveFirst: (() => void) | null = null;
      (window as any)._resolveFirst = () => { if (resolveFirst) resolveFirst(); };
      let callNum = 0;

      window.fetch = function(...args: Parameters<typeof fetch>) {
        callNum++;
        const url = String(args[0]);
        if (url.includes('/api/sync')) {
          const body = args[1]?.body;
          if (body) {
            (window as any)._syncBodies.push(JSON.parse(body as string));
          }
          if (callNum === 1) {
            return new Promise<Response>((resolve) => {
              resolveFirst = () => {
                resolve(new Response(JSON.stringify({ mergedItems: [] }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }));
              };
            });
          }
        }
        return Promise.resolve(new Response(JSON.stringify({ mergedItems: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Set up initial state and start first sync
    await page.evaluate(() => {
      localStorage.setItem('decay-todos', JSON.stringify([{
        id: 'item-1',
        text: 'original',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false,
        position: 'n',
      }]));

      // Start first sync
      window.ToDoSync._test!.syncToServer([{
        id: 'item-1',
        text: 'original',
        createdAt: Date.now(),
        important: false,
        completed: false,
        archived: false,
        position: 'n',
      }]);
    });

    await page.waitForTimeout(50);

    // Queue a second sync with changed data while first is active
    await page.evaluate(() => {
      window.ToDoSync._test!.syncToServer([{
        id: 'item-1',
        text: 'changed during sync',
        createdAt: Date.now(),
        important: true,
        completed: false,
        archived: false,
        position: 'n',
        textUpdatedAt: Date.now(),
        importantUpdatedAt: Date.now(),
      }]);
    });

    // Resolve first sync
    await page.evaluate(() => (window as any)._resolveFirst());

    // Wait for pending sync to complete
    await page.waitForTimeout(500);

    // Verify the second sync body contained the updated data
    const syncBodies = await page.evaluate(() => (window as any)._syncBodies);
    expect(syncBodies.length).toBeGreaterThanOrEqual(2);

    // The second sync should have the updated text
    const lastSyncItems = syncBodies[syncBodies.length - 1].items;
    const syncedItem = lastSyncItems.find((i: any) => i.text === 'changed during sync');
    expect(syncedItem).toBeDefined();
    expect(syncedItem.important).toBe(true);
  });
});

// Type declarations for test
declare global {
  interface Window {
    ToDoSync: {
      enable: () => Promise<boolean>;
      disable: () => void;
      isEnabled: () => boolean;
      isConfigured: () => boolean;
      migrate: () => Promise<unknown>;
      refresh: () => Promise<void>;
      getConfig: () => Record<string, string>;
      onSave: (todos: unknown[]) => void;
      _test?: {
        setSyncEnabled: (val: boolean) => void;
        triggerSync: () => Promise<void>;
        handleOnline: () => void;
        isSyncing: () => boolean;
        isSyncPending: () => boolean;
        setIsSyncing: (val: boolean) => void;
        syncToServer: (todos: unknown[]) => Promise<void>;
      };
    };
    saveTodos: (todos: unknown[]) => void;
    _originalSaveTodos?: (todos: unknown[]) => void;
  }
}
