import { test, expect } from '@playwright/test';
import { setupPage, addTodo, getTodoTexts, getStoredTodos } from './helpers';

test.describe('loadTodos() in-memory cache', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('loadTodos returns same data whether cached or uncached', async ({ page }) => {
    const result = await page.evaluate(() => {
      const todos = [
        { id: 'a', text: 'Alpha', createdAt: Date.now(), important: false, completed: false, archived: false },
        { id: 'b', text: 'Beta', createdAt: Date.now(), important: true, completed: false, archived: false },
      ];
      window.saveTodos(todos);

      const first = window.loadTodos();
      const second = window.loadTodos();

      return {
        firstTexts: first.map((t: { text: string }) => t.text),
        secondTexts: second.map((t: { text: string }) => t.text),
        deepEqual: JSON.stringify(first) === JSON.stringify(second),
      };
    });

    expect(result.firstTexts).toEqual(['Alpha', 'Beta']);
    expect(result.secondTexts).toEqual(['Alpha', 'Beta']);
    expect(result.deepEqual).toBe(true);
  });

  test('saveTodos updates the cache so loadTodos returns new data', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.saveTodos([{ id: 'x', text: 'Old', createdAt: Date.now(), important: false, completed: false, archived: false }]);
      const before = window.loadTodos();

      window.saveTodos([{ id: 'x', text: 'New', createdAt: Date.now(), important: false, completed: false, archived: false }]);
      const after = window.loadTodos();

      return {
        beforeText: before[0].text,
        afterText: after[0].text,
      };
    });

    expect(result.beforeText).toBe('Old');
    expect(result.afterText).toBe('New');
  });

  test('cached loadTodos avoids JSON.parse when data has not changed', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.saveTodos([
        { id: '1', text: 'Cached item', createdAt: Date.now(), important: false, completed: false, archived: false },
      ]);

      // Prime the cache
      window.loadTodos();

      // Spy on JSON.parse
      let parseCallCount = 0;
      const originalParse = JSON.parse;
      JSON.parse = function(text: string) {
        parseCallCount++;
        return originalParse(text);
      };

      const callCount = 50;
      for (let i = 0; i < callCount; i++) {
        window.loadTodos();
      }

      JSON.parse = originalParse;

      return { parseCallCount, callCount };
    });

    // Cache hits skip JSON.parse entirely — parsed result is cached in memory.
    expect(result.parseCallCount).toBe(0);
  });

  test('cache invalidation works when localStorage is written directly', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.saveTodos([{ id: '1', text: 'Original', createdAt: Date.now(), important: false, completed: false, archived: false }]);
      const before = window.loadTodos();

      // Write directly to localStorage (simulating sync.js)
      localStorage.setItem('decay-todos', JSON.stringify([
        { id: '1', text: 'Synced from server', createdAt: Date.now(), important: false, completed: false, archived: false },
      ]));

      // Invalidate cache (as sync.js would do)
      window.invalidateTodoCache();

      const after = window.loadTodos();

      return {
        beforeText: before[0].text,
        afterText: after[0].text,
      };
    });

    expect(result.beforeText).toBe('Original');
    expect(result.afterText).toBe('Synced from server');
  });

  test('cache detects external localStorage changes even without explicit invalidation', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.saveTodos([{ id: '1', text: 'Initial', createdAt: Date.now(), important: false, completed: false, archived: false }]);
      window.loadTodos(); // prime cache

      // Write directly without invalidation
      localStorage.setItem('decay-todos', JSON.stringify([
        { id: '1', text: 'Changed externally', createdAt: Date.now(), important: false, completed: false, archived: false },
      ]));

      const todos = window.loadTodos();
      return { text: todos[0].text };
    });

    expect(result.text).toBe('Changed externally');
  });

  test('loadTodos returns empty array when localStorage is empty', async ({ page }) => {
    const result = await page.evaluate(() => {
      localStorage.removeItem('decay-todos');
      window.invalidateTodoCache();
      const todos = window.loadTodos();
      return { length: todos.length, isArray: Array.isArray(todos) };
    });

    expect(result.length).toBe(0);
    expect(result.isArray).toBe(true);
  });

  test('loadTodos returns independent arrays (push does not affect cache)', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.saveTodos([
        { id: '1', text: 'Immutable', createdAt: Date.now(), important: false, completed: false, archived: false },
      ]);

      const copy1 = window.loadTodos();
      copy1.push({ id: '2', text: 'Added', createdAt: Date.now() });

      const copy2 = window.loadTodos();

      return {
        copy1Length: copy1.length,
        copy2Length: copy2.length,
      };
    });

    // Array-level mutations (push/splice) don't affect the cache
    expect(result.copy1Length).toBe(2);
    expect(result.copy2Length).toBe(1);
  });

  test('invalidateTodoCache function is available on window', async ({ page }) => {
    const result = await page.evaluate(() => {
      return typeof window.invalidateTodoCache === 'function';
    });
    expect(result).toBe(true);
  });

  test('app works end-to-end with caching (add, complete, delete)', async ({ page }) => {
    await addTodo(page, 'Cache test item 1');
    await addTodo(page, 'Cache test item 2');

    let texts = await getTodoTexts(page);
    expect(texts).toEqual(['Cache test item 1', 'Cache test item 2']);

    let stored = await getStoredTodos(page);
    expect(stored.length).toBe(2);

    // Complete first item
    const todo1 = page.locator('.todo-item:has(.text:text("Cache test item 1"))');
    await todo1.locator('.checkbox').click();

    stored = await getStoredTodos(page);
    const item1 = stored.find((t: { text: string }) => t.text === 'Cache test item 1');
    expect(item1.completed).toBe(true);

    // Delete second item
    const todo2 = page.locator('.todo-item:has(.text:text("Cache test item 2"))');
    await todo2.hover();
    await todo2.locator('.actions button:has-text("\u00d7")').click();

    stored = await getStoredTodos(page);
    expect(stored.length).toBe(1);
    expect(stored[0].text).toBe('Cache test item 1');
  });
});
