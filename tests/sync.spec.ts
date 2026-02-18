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

    // Enable sync via _test helper + set fake auth token
    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
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

  test('handleOnline triggers event-based sync', async ({ page }) => {
    await setupPage(page);

    // Enable sync + set fake auth token
    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
      window.ToDoSync._test!.setSyncEnabled(true);
    });

    // Install fetch spy that tracks URLs
    await page.evaluate(() => {
      (window as Window & { _fetchUrls: string[] })._fetchUrls = [];
      window.fetch = function(...args: Parameters<typeof fetch>) {
        (window as Window & { _fetchUrls: string[] })._fetchUrls.push(String(args[0]));
        return Promise.resolve(new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    // Call handleOnline
    await page.evaluate(() => {
      window.ToDoSync._test!.handleOnline();
    });

    // Wait for fetch to /api/events (replaces hardcoded debounce wait)
    await page.waitForFunction(
      () => (window as any)._fetchUrls?.some((url: string) => url.includes('/api/events')),
      null,
      { timeout: 10000 }
    );

    const fetchUrls = await page.evaluate(() => {
      return (window as Window & { _fetchUrls: string[] })._fetchUrls;
    });

    // handleOnline triggers event-based sync only
    const eventsFetched = fetchUrls.some(url => url.includes('/api/events'));
    expect(eventsFetched).toBe(true);
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

  test('pullEvents paginates when server returns full pages', async ({ page }) => {
    await setupPage(page);

    const result = await page.evaluate(async () => {
      const PAGE_SIZE = window.ToDoSync._test!.PULL_PAGE_SIZE;
      let fetchCallCount = 0;

      // Mock fetch to return paginated responses
      window.fetch = function(...args: Parameters<typeof fetch>) {
        fetchCallCount++;
        const url = String(args[0]);
        const sinceMatch = url.match(/since=(\d+)/);
        const since = sinceMatch ? parseInt(sinceMatch[1]) : 0;

        let count: number;
        if (since < PAGE_SIZE * 2) {
          count = PAGE_SIZE; // Full pages
        } else {
          count = 10; // Partial final page
        }

        const events = [];
        for (let i = 1; i <= count; i++) {
          events.push({
            id: `evt-${since + i}`,
            itemId: `item-${since + i}`,
            type: 'item_created',
            field: null,
            value: { text: 'test', position: 'n' },
            timestamp: Date.now(),
            clientId: 'other-client',
            seq: since + i,
          });
        }

        return Promise.resolve(new Response(JSON.stringify({ events }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };

      (window as any).SYNC_API_URL = '';
      window.ToDoSync._test!.setAccessTokenOverride('test-token');

      await window.ToDoSync._test!.pullEvents();

      const cursor = parseInt(localStorage.getItem('decay-event-cursor') || '0');
      return { fetchCallCount, cursor, PAGE_SIZE };
    });

    // 2 full pages + 1 partial = 3 fetches
    expect(result.fetchCallCount).toBe(3);
    expect(result.cursor).toBe(result.PAGE_SIZE * 2 + 10);
  });

  test('pullEvents stops after single page when fewer than PAGE_SIZE', async ({ page }) => {
    await setupPage(page);

    const result = await page.evaluate(async () => {
      let fetchCallCount = 0;

      window.fetch = function() {
        fetchCallCount++;
        const events = [];
        for (let i = 1; i <= 50; i++) {
          events.push({
            id: `evt-${i}`,
            itemId: `item-${i}`,
            type: 'item_created',
            field: null,
            value: { text: 'test', position: 'n' },
            timestamp: Date.now(),
            clientId: 'other-client',
            seq: i,
          });
        }

        return Promise.resolve(new Response(JSON.stringify({ events }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };

      (window as any).SYNC_API_URL = '';
      window.ToDoSync._test!.setAccessTokenOverride('test-token');

      await window.ToDoSync._test!.pullEvents();

      const cursor = parseInt(localStorage.getItem('decay-event-cursor') || '0');
      return { fetchCallCount, cursor };
    });

    expect(result.fetchCallCount).toBe(1);
    expect(result.cursor).toBe(50);
  });

  test('pullEvents respects MAX_PULL_PAGES safety cap', async ({ page }) => {
    await setupPage(page);

    const result = await page.evaluate(async () => {
      const PAGE_SIZE = window.ToDoSync._test!.PULL_PAGE_SIZE;
      const MAX_PAGES = window.ToDoSync._test!.MAX_PULL_PAGES;
      let fetchCallCount = 0;

      // Always return a full page (simulates infinite events)
      // Reuse a small set of itemIds to avoid localStorage quota issues
      window.fetch = function(...args: Parameters<typeof fetch>) {
        fetchCallCount++;
        const url = String(args[0]);
        const sinceMatch = url.match(/since=(\d+)/);
        const since = sinceMatch ? parseInt(sinceMatch[1]) : 0;

        const events = [];
        for (let i = 1; i <= PAGE_SIZE; i++) {
          events.push({
            id: `evt-${since + i}`,
            itemId: `item-${(i - 1) % 5}`,
            type: 'item_created',
            field: null,
            value: { text: 'test', position: 'n' },
            timestamp: Date.now(),
            clientId: 'other-client',
            seq: since + i,
          });
        }

        return Promise.resolve(new Response(JSON.stringify({ events }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };

      (window as any).SYNC_API_URL = '';
      window.ToDoSync._test!.setAccessTokenOverride('test-token');

      await window.ToDoSync._test!.pullEvents();

      return { fetchCallCount, MAX_PAGES };
    });

    // Should stop at MAX_PULL_PAGES
    expect(result.fetchCallCount).toBe(result.MAX_PAGES);
  });

  test('sync failure schedules a retry timer', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
      window.ToDoSync._test!.setSyncEnabled(true);
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ error: 'Server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    await page.evaluate(() => window.ToDoSync._test!.triggerEventSync());

    const retryState = await page.evaluate(() => ({
      retryCount: window.ToDoSync._test!.retryCount(),
      hasRetryTimer: window.ToDoSync._test!.retryTimer() !== null,
    }));

    expect(retryState.retryCount).toBe(1);
    expect(retryState.hasRetryTimer).toBe(true);

    await page.evaluate(() => window.ToDoSync._test!.clearRetryTimer());
  });

  test('retry count resets on successful sync', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
      window.ToDoSync._test!.setSyncEnabled(true);
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    await page.evaluate(() => window.ToDoSync._test!.triggerEventSync());
    const afterFail = await page.evaluate(() => window.ToDoSync._test!.retryCount());
    expect(afterFail).toBe(1);

    await page.evaluate(() => {
      window.ToDoSync._test!.clearRetryTimer();
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    await page.evaluate(() => window.ToDoSync._test!.triggerEventSync());
    const afterSuccess = await page.evaluate(() => window.ToDoSync._test!.retryCount());
    expect(afterSuccess).toBe(0);
  });

  test('disableSync clears retry timer', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
      window.ToDoSync._test!.setSyncEnabled(true);
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    await page.evaluate(() => window.ToDoSync._test!.triggerEventSync());
    const hasTimer = await page.evaluate(() => window.ToDoSync._test!.retryTimer() !== null);
    expect(hasTimer).toBe(true);

    await page.evaluate(() => window.ToDoSync.disable());

    const afterDisable = await page.evaluate(() => ({
      retryCount: window.ToDoSync._test!.retryCount(),
      hasRetryTimer: window.ToDoSync._test!.retryTimer() !== null,
    }));
    expect(afterDisable.retryCount).toBe(0);
    expect(afterDisable.hasRetryTimer).toBe(false);
  });

  test('queueServerSync clears pending retry', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(() => {
      window.ToDoSync._test!.setAccessTokenOverride('test-token');
      window.ToDoSync._test!.setSyncEnabled(true);
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
    });

    await page.evaluate(() => window.ToDoSync._test!.triggerEventSync());
    const hasTimer = await page.evaluate(() => window.ToDoSync._test!.retryTimer() !== null);
    expect(hasTimer).toBe(true);

    await page.evaluate(() => {
      window.fetch = function() {
        return Promise.resolve(new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      };
      window.ToDoSync.onEventsAppended([]);
    });

    const afterQueue = await page.evaluate(() => ({
      retryCount: window.ToDoSync._test!.retryCount(),
      hasRetryTimer: window.ToDoSync._test!.retryTimer() !== null,
    }));
    // retryCount persists until sync actually succeeds (not reset by queueServerSync)
    expect(afterQueue.retryCount).toBe(1);
    expect(afterQueue.hasRetryTimer).toBe(false);
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
      refresh: () => Promise<void>;
      getConfig: () => Record<string, string>;
      onEventsAppended: (events: unknown[]) => void;
      _test?: {
        setSyncEnabled: (val: boolean) => void;
        setAccessTokenOverride: (token: string | null) => void;
        triggerEventSync: () => Promise<void>;
        handleOnline: () => void;
        isSyncing: () => boolean;
        isSyncPending: () => boolean;
        pullEvents: () => Promise<void>;
        PULL_PAGE_SIZE: number;
        MAX_PULL_PAGES: number;
        retryCount: () => number;
        retryTimer: () => ReturnType<typeof setTimeout> | null;
        clearRetryTimer: () => void;
        MAX_RETRIES: number;
        BASE_RETRY_MS: number;
        MAX_RETRY_MS: number;
      };
    };
    saveTodos: (todos: unknown[]) => void;
    _originalSaveTodos?: (todos: unknown[]) => void;
  }
}
