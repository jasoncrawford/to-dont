import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getStoredTodos,
  createSection,
} from './helpers';

test.describe('Click Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Todo Item Clicks', () => {
    test('should toggle complete when clicking checkbox', async ({ page }) => {
      await addTodo(page, 'Test item');

      const checkbox = page.locator('.todo-item .checkbox').first();
      await checkbox.click();

      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(true);
    });

    test('should untoggle complete when clicking checkbox again', async ({ page }) => {
      await addTodo(page, 'Test item');

      const checkbox = page.locator('.todo-item .checkbox').first();
      await checkbox.click();
      await checkbox.click();

      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(false);
    });

    test('should focus text at end when clicking to the right of item', async ({ page }) => {
      await addTodo(page, 'Test item');

      // Click on the todo item div (not on text or checkbox)
      const todoItem = page.locator('.todo-item').first();
      const box = await todoItem.boundingBox();

      // Click on the right side of the item (past the text)
      await page.mouse.click(box!.x + box!.width - 20, box!.y + box!.height / 2);

      // Text should be focused
      const text = page.locator('.todo-item .text').first();
      await expect(text).toBeFocused();

      // Item should NOT be completed (old behavior would toggle)
      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(false);
    });

    test('should not toggle complete when clicking on text', async ({ page }) => {
      await addTodo(page, 'Test item');

      const text = page.locator('.todo-item .text').first();
      await text.click();

      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(false);
    });

    test('should focus text when clicking on date area', async ({ page }) => {
      await addTodo(page, 'Test item');

      // Click on the date element
      const date = page.locator('.todo-item .date').first();
      await date.click();

      // Text should be focused
      const text = page.locator('.todo-item .text').first();
      await expect(text).toBeFocused();

      // Item should NOT be completed
      const stored = await getStoredTodos(page);
      expect(stored[0].completed).toBe(false);
    });
  });

  test.describe('Section Header Clicks', () => {
    test('should focus text at end when clicking to the right of section', async ({ page }) => {
      await createSection(page, 'Test Section');

      // Click on the section header div (not on text)
      const sectionHeader = page.locator('.section-header').first();
      const box = await sectionHeader.boundingBox();

      // Click on the right side of the header (past the text)
      await page.mouse.click(box!.x + box!.width - 20, box!.y + box!.height / 2);

      // Text should be focused
      const text = page.locator('.section-header .text').first();
      await expect(text).toBeFocused();
    });

    test('should focus text when clicking on section background', async ({ page }) => {
      await createSection(page, 'Test Section');

      // Click on the section header area (not directly on text)
      const sectionHeader = page.locator('.section-header').first();
      const box = await sectionHeader.boundingBox();

      // Click near the left but not on the drag handle or text
      await page.mouse.click(box!.x + 50, box!.y + box!.height / 2);

      // Text should be focused
      const text = page.locator('.section-header .text').first();
      await expect(text).toBeFocused();
    });
  });
});
