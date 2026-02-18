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
  CMD,
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

    test('should focus first item after creating via NewItemInput', async ({ page }) => {
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('First item');
      await input.press('Enter');

      await page.waitForSelector('.todo-item');

      // Focus should land on the newly created item
      const focused = page.locator('.todo-item .text:focus');
      await expect(focused).toBeVisible();
      await expect(focused).toHaveText('First item');
    });

    test('should allow Enter on first item to create second item', async ({ page }) => {
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('First item');
      await input.press('Enter');

      await page.waitForSelector('.todo-item');

      // Press Enter again — should create a second item since focus is on the first
      await page.keyboard.press('Enter');
      await expect(page.locator('.todo-item')).toHaveCount(2);
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

      // Check it's not in main list
      const mainList = page.locator('#todoList');
      const mainTodo = mainList.locator('.todo-item:has(.text:text("Old task"))');
      await expect(mainTodo).toHaveCount(0);

      // Click the Faded tab and check the item appears there
      await page.locator('#fadedViewBtn').click();
      const fadedList = page.locator('#todoList');
      const fadedTodo = fadedList.locator('.todo-item:has(.text:text("Old task"))');
      await expect(fadedTodo).toBeVisible();
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
    test('should update textUpdatedAt when editing via blur', async ({ page }) => {
      await addTodo(page, 'Original text');

      const stored = await getStoredTodos(page);
      const initialTextUpdatedAt = stored[0].textUpdatedAt;
      expect(initialTextUpdatedAt).toBeDefined();

      // Small delay so timestamps differ
      await page.waitForTimeout(50);

      // Edit the text
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        el.textContent = 'Edited text';
      });

      // Blur to trigger updateTodoText
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(100);

      const updated = await getStoredTodos(page);
      expect(updated[0].text).toBe('Edited text');
      expect(updated[0].textUpdatedAt).toBeGreaterThan(initialTextUpdatedAt);
    });

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

    test('should keep empty items when blurred', async ({ page }) => {
      await addTodo(page, 'Will be emptied');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Clear text
      await textEl.press(`${CMD}+a`);
      await textEl.press('Backspace');

      // Blur
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(100);

      // Item should still exist
      const todoCount = await page.locator('.todo-item').count();
      expect(todoCount).toBe(1);

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('');
    });

    test('should paste as plain text', async ({ page }) => {
      await addTodo(page, 'Test');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');

      // Simulate paste with HTML content
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData!.setData('text/html', '<b>bold</b> text');
        pasteEvent.clipboardData!.setData('text/plain', 'bold text');
        el.dispatchEvent(pasteEvent);
      });

      await page.waitForTimeout(100);

      // Should have plain text, not HTML
      const html = await textEl.innerHTML();
      expect(html).not.toContain('<b>');
      expect(html).toContain('bold text');
    });
  });

  test.describe('Importance Shortcut', () => {
    test('should turn on important when typing !', async ({ page }) => {
      await addTodo(page, 'Task');

      const todoItem = page.locator('.todo-item').first();
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');
      await textEl.pressSequentially('!');

      // Visual class should appear immediately (while still focused)
      await expect(todoItem).toHaveClass(/important-level-/);

      const stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(true);
    });

    test('should turn off important when deleting last !', async ({ page }) => {
      await addTodo(page, 'Task!');

      // Make it important first
      const todoItem = page.locator('.todo-item').first();
      await todoItem.hover();
      await todoItem.locator('.important-btn').click();
      await expect(todoItem).toHaveClass(/important-level-/);

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');
      await textEl.press('Backspace'); // Delete the !

      // Visual class should be removed immediately (while still focused)
      await expect(todoItem).not.toHaveClass(/important-level-/);

      const stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(false);
    });

    test('should not change importance when editing text with existing !', async ({ page }) => {
      await addTodo(page, 'Task');

      // Type ! to make it important
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');
      await textEl.pressSequentially('!');
      await page.waitForTimeout(100);

      let stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(true);

      // Click the button to turn OFF importance
      const todo = page.locator('.todo-item').first();
      await todo.hover();
      await todo.locator('.important-btn').click();

      stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(false);

      // Now edit the text (add something, not a !)
      await textEl.click();
      await textEl.press('Home');
      await textEl.pressSequentially('My ');

      await page.waitForTimeout(100);

      // Important should still be false (editing didn't re-trigger)
      stored = await getStoredTodos(page);
      expect(stored[0].important).toBe(false);
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
