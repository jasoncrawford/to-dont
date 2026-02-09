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
    };
    saveTodos: (todos: unknown[]) => void;
    _originalSaveTodos?: (todos: unknown[]) => void;
  }
}
