import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getTodoByText,
  completeTodo,
  toggleImportant,
  deleteTodo,
  getStoredTodos,
  setVirtualTime,
} from './helpers';

test.describe('Core Todo Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Adding Todos', () => {
    test('should add a new todo item', async ({ page }) => {
      await addTodo(page, 'Buy groceries');

      const texts = await getTodoTexts(page);
      expect(texts).toContain('Buy groceries');
    });

    test('should add multiple todos in order', async ({ page }) => {
      await addTodo(page, 'First task');
      await addTodo(page, 'Second task');
      await addTodo(page, 'Third task');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First task', 'Second task', 'Third task']);
    });

    test('should persist todos to localStorage', async ({ page }) => {
      await addTodo(page, 'Persistent task');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('Persistent task');
    });

    test('should set createdAt timestamp on new todos', async ({ page }) => {
      const beforeTime = Date.now();
      await addTodo(page, 'Timestamped task');
      const afterTime = Date.now();

      const stored = await getStoredTodos(page);
      expect(stored[0].createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(stored[0].createdAt).toBeLessThanOrEqual(afterTime);
    });
  });

  test.describe('Completing Todos', () => {
    test('should mark todo as completed when checkbox clicked', async ({ page }) => {
      await addTodo(page, 'Task to complete');
      await completeTodo(page, 'Task to complete');

      const todo = await getTodoByText(page, 'Task to complete');
      await expect(todo).toHaveClass(/completed/);
    });

    test('should record completedAt timestamp when completed', async ({ page }) => {
      await addTodo(page, 'Task to complete');
      const beforeTime = Date.now();
      await completeTodo(page, 'Task to complete');
      const afterTime = Date.now();

      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(true);
      expect(stored[0].completedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(stored[0].completedAt).toBeLessThanOrEqual(afterTime);
    });

    test('should remove completedAt when uncompleted', async ({ page }) => {
      await addTodo(page, 'Task to toggle');
      await completeTodo(page, 'Task to toggle');

      let stored = await getStoredTodos(page);
      expect(stored[0].completedAt).toBeDefined();

      await completeTodo(page, 'Task to toggle'); // uncomplete
      stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(false);
      expect(stored[0].completedAt).toBeUndefined();
    });

    test('should use virtual time for completedAt in test mode', async ({ page }) => {
      // Set virtual time to 5 days in the future
      await setVirtualTime(page, 5);

      await addTodo(page, 'Future task');
      await completeTodo(page, 'Future task');

      const stored = await getStoredTodos(page);
      const now = Date.now();
      const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

      // completedAt should be roughly 5 days from now
      expect(stored[0].completedAt).toBeGreaterThan(now + fiveDaysMs - 60000);
      expect(stored[0].completedAt).toBeLessThan(now + fiveDaysMs + 60000);
    });
  });

  test.describe('Important Flag', () => {
    test('should toggle important status', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      const stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(true);

      await toggleImportant(page, 'Important task');
      const stored2 = await getStoredTodos(page);
      expect(stored2[0].important).toBe(false);
    });

    test('should apply important styling', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      const todo = await getTodoByText(page, 'Important task');
      // Should have one of the important-level classes
      const className = await todo.getAttribute('class');
      expect(className).toMatch(/important-level-/);
    });
  });

  test.describe('Deleting Todos', () => {
    test('should delete todo when delete button clicked', async ({ page }) => {
      await addTodo(page, 'Task to delete');
      await addTodo(page, 'Task to keep');

      await deleteTodo(page, 'Task to delete');

      const texts = await getTodoTexts(page);
      expect(texts).not.toContain('Task to delete');
      expect(texts).toContain('Task to keep');
    });

    test('should remove from localStorage', async ({ page }) => {
      await addTodo(page, 'Task to delete');
      await deleteTodo(page, 'Task to delete');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(0);
    });
  });

  test.describe('Auto-Archiving', () => {
    test('should auto-archive items after 14 days', async ({ page }) => {
      await addTodo(page, 'Old task');

      // Advance time by 14+ days to trigger auto-archive
      for (let i = 0; i < 15; i++) {
        await page.locator('#advanceDay').click();
      }

      // Check it's in the archive section
      const archiveSection = page.locator('#archiveSection');
      await expect(archiveSection).toBeVisible();

      // Expand archive to see items
      await page.locator('#archiveToggle').click();
      const archiveList = page.locator('#archiveList');
      await expect(archiveList).toHaveClass(/expanded/);

      const archivedTodo = archiveList.locator('.todo-item:has(.text:text("Old task"))');
      await expect(archivedTodo).toBeVisible();

      // Check it's not in main list
      const mainList = page.locator('#todoList');
      const mainTodo = mainList.locator('.todo-item:has(.text:text("Old task"))');
      await expect(mainTodo).toHaveCount(0);
    });

    test('should set archived flag in localStorage after 14 days', async ({ page }) => {
      await addTodo(page, 'Old task');

      // Advance time by 14+ days
      for (let i = 0; i < 15; i++) {
        await page.locator('#advanceDay').click();
      }

      const stored = await getStoredTodos(page);
      expect(stored[0].archived).toBe(true);
    });

    test('should NOT auto-archive important items', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      // Advance time by 14+ days
      for (let i = 0; i < 15; i++) {
        await page.locator('#advanceDay').click();
      }

      // Should still be in main list
      const mainList = page.locator('#todoList');
      const mainTodo = mainList.locator('.todo-item:has(.text:text("Important task"))');
      await expect(mainTodo).toBeVisible();

      const stored = await getStoredTodos(page);
      expect(stored[0].archived).toBe(false);
    });
  });

  test.describe('Inline Editing', () => {
    test('should edit todo text inline', async ({ page }) => {
      await addTodo(page, 'Original text');

      // Re-locate the element fresh
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Clear existing text and type new text using evaluate
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        el.textContent = 'Updated text';
      });

      // Click elsewhere to blur and trigger save
      await page.locator('body').click({ position: { x: 10, y: 10 } });

      // Wait a bit for save to process
      await page.waitForTimeout(100);

      const stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('Updated text');
    });
  });

  test.describe('Persistence', () => {
    test('should reload todos from localStorage on page refresh', async ({ page }) => {
      await addTodo(page, 'Persistent task');
      await page.reload();
      await page.waitForSelector('#todoList');

      const texts = await getTodoTexts(page);
      expect(texts).toContain('Persistent task');
    });
  });
});
