import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getStoredTodos,
  completeTodo,
  setVirtualTime,
} from './helpers';

test.describe('Done View', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Navigation', () => {
    test('should show Done option in view toggle', async ({ page }) => {
      const doneBtn = page.locator('#doneViewBtn');
      await expect(doneBtn).toBeVisible();
      await expect(doneBtn).toHaveText('Done');
    });

    test('should switch to Done view when clicked', async ({ page }) => {
      const doneBtn = page.locator('#doneViewBtn');
      await doneBtn.click();

      // Done button should be active
      await expect(doneBtn).toHaveClass(/active/);
    });

    test('should persist Done view mode in localStorage', async ({ page }) => {
      await page.locator('#doneViewBtn').click();

      const viewMode = await page.evaluate(() => localStorage.getItem('decay-todos-view-mode'));
      expect(viewMode).toBe('done');
    });
  });

  test.describe('Done View Display', () => {
    test('should show completed items in Done view', async ({ page }) => {
      await addTodo(page, 'Task to complete');
      await completeTodo(page, 'Task to complete');

      await page.locator('#doneViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Task to complete');
    });

    test('should group completed items by day with Today header', async ({ page }) => {
      await addTodo(page, 'Completed today');
      await completeTodo(page, 'Completed today');

      await page.locator('#doneViewBtn').click();

      const dayHeader = page.locator('.day-header').first();
      await expect(dayHeader).toHaveText('Today');
    });

    test('should show Yesterday header for items completed yesterday', async ({ page }) => {
      await addTodo(page, 'Task 1');
      await completeTodo(page, 'Task 1');

      // Advance time by 1 day
      await setVirtualTime(page, 1);

      await page.locator('#doneViewBtn').click();

      const dayHeader = page.locator('.day-header').first();
      await expect(dayHeader).toHaveText('Yesterday');
    });

    test('should show date for items completed more than 2 days ago', async ({ page }) => {
      await addTodo(page, 'Old task');
      await completeTodo(page, 'Old task');

      // Advance time by 3 days
      await setVirtualTime(page, 3);

      await page.locator('#doneViewBtn').click();

      const dayHeader = page.locator('.day-header').first();
      // Should be a date format like "Jan 12", not "Today" or "Yesterday"
      const headerText = await dayHeader.textContent();
      expect(headerText).not.toBe('Today');
      expect(headerText).not.toBe('Yesterday');
      expect(headerText).toMatch(/[A-Z][a-z]{2} \d{1,2}/); // e.g., "Jan 12"
    });

    test('should sort items in reverse chronological order', async ({ page }) => {
      await addTodo(page, 'First completed');
      await completeTodo(page, 'First completed');

      await addTodo(page, 'Second completed');
      await completeTodo(page, 'Second completed');

      await page.locator('#doneViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      // Most recently completed should be first
      expect(todoTexts[0]).toBe('Second completed');
      expect(todoTexts[1]).toBe('First completed');
    });

    test('should group items by day in order', async ({ page }) => {
      // Complete task on day 0
      await addTodo(page, 'Day 0 task');
      await completeTodo(page, 'Day 0 task');

      // Advance to day 1 and complete another
      await setVirtualTime(page, 1);
      await addTodo(page, 'Day 1 task');
      await completeTodo(page, 'Day 1 task');

      await page.locator('#doneViewBtn').click();

      const dayHeaders = page.locator('.day-header');
      await expect(dayHeaders).toHaveCount(2);

      // Today (Day 1) should be first
      await expect(dayHeaders.first()).toHaveText('Today');
      // Yesterday (Day 0) should be second
      await expect(dayHeaders.last()).toHaveText('Yesterday');
    });

    test('should not show incomplete items in Done view', async ({ page }) => {
      await addTodo(page, 'Incomplete task');
      await addTodo(page, 'Completed task');
      await completeTodo(page, 'Completed task');

      await page.locator('#doneViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Incomplete task');
      expect(todoTexts).toContain('Completed task');
    });

    test('should hide new item input in Done view', async ({ page }) => {
      await page.locator('#doneViewBtn').click();

      const newItemInput = page.locator('.new-item');
      await expect(newItemInput).not.toBeVisible();
    });

    test('should hide drag handles in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      await page.locator('#doneViewBtn').click();

      const dragHandle = page.locator('.todo-item .drag-handle').first();
      await expect(dragHandle).not.toBeVisible();
    });

    test('should not show strikethrough in Done view', async ({ page }) => {
      await addTodo(page, 'Completed task');
      await completeTodo(page, 'Completed task');

      await page.locator('#doneViewBtn').click();

      const textEl = page.locator('.todo-item .text').first();
      const textDecoration = await textEl.evaluate(el =>
        window.getComputedStyle(el).textDecoration
      );
      expect(textDecoration).not.toContain('line-through');
    });

    test('should disable checkbox clicks in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      await page.locator('#doneViewBtn').click();

      // Click the checkbox
      const checkbox = page.locator('.todo-item .checkbox').first();
      await checkbox.click();

      // Item should still be completed
      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(true);
    });

    test('should hide important button in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      await page.locator('#doneViewBtn').click();

      const importantBtn = page.locator('.todo-item .important-btn');
      await expect(importantBtn).toHaveCount(0);
    });
  });

  test.describe('Archive Completed Button', () => {
    test('should show Archive Completed button when there are completed items', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      const archiveBtn = page.locator('#archiveCompletedBtn');
      await expect(archiveBtn).toBeVisible();
    });

    test('should disable Archive Completed button when no completed items', async ({ page }) => {
      await addTodo(page, 'Incomplete task');

      const archiveBtn = page.locator('#archiveCompletedBtn');
      await expect(archiveBtn).toBeVisible();
      await expect(archiveBtn).toBeDisabled();
    });

    test('should archive all completed items when clicked', async ({ page }) => {
      await addTodo(page, 'Task 1');
      await addTodo(page, 'Task 2');
      await completeTodo(page, 'Task 1');
      await completeTodo(page, 'Task 2');

      await page.locator('#archiveCompletedBtn').click();

      const stored = await getStoredTodos(page);
      const archivedCount = stored.filter((t: any) => t.archived).length;
      expect(archivedCount).toBe(2);
    });

    test('should remove archived completed items from Custom view', async ({ page }) => {
      await addTodo(page, 'Completed task');
      await addTodo(page, 'Incomplete task');
      await completeTodo(page, 'Completed task');

      await page.locator('#archiveCompletedBtn').click();

      // Should still be in Custom view
      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Completed task');
      expect(todoTexts).toContain('Incomplete task');
    });

    test('should disable Archive Completed button after archiving', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      await page.locator('#archiveCompletedBtn').click();

      const archiveBtn = page.locator('#archiveCompletedBtn');
      await expect(archiveBtn).toBeVisible();
      await expect(archiveBtn).toBeDisabled();
    });

    test('should not show Archive Completed button in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      await page.locator('#doneViewBtn').click();

      const archiveContainer = page.locator('#archiveCompletedContainer');
      await expect(archiveContainer).not.toBeVisible();
    });
  });

  test.describe('Archived Items in Done View', () => {
    test('should show archived completed items in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');
      await page.locator('#archiveCompletedBtn').click();

      // Item should be gone from Custom view
      let todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Task');

      // But should appear in Done view
      await page.locator('#doneViewBtn').click();
      todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Task');
    });

    test('should not show archived completed items in Active view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');
      await page.locator('#archiveCompletedBtn').click();

      // Should already be in Active view, but click to confirm
      await page.locator('#activeViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Task');
    });
  });
});
