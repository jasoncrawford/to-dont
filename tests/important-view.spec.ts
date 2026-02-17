import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getTodoByText,
  completeTodo,
  toggleImportant,
  getStoredTodos,
} from './helpers';

test.describe('Important View', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Navigation', () => {
    test('should show Important tab in view toggle', async ({ page }) => {
      const importantBtn = page.locator('#importantViewBtn');
      await expect(importantBtn).toBeVisible();
      await expect(importantBtn).toHaveText('Important');
    });

    test('should be the first tab (before Active)', async ({ page }) => {
      const tabs = page.locator('.view-tabs-left button');
      await expect(tabs.first()).toHaveText('Important');
      await expect(tabs.nth(1)).toHaveText('Active');
    });

    test('should switch to Important view when clicked', async ({ page }) => {
      const importantBtn = page.locator('#importantViewBtn');
      await importantBtn.click();

      await expect(importantBtn).toHaveClass(/active/);
    });

    test('should be the default view on fresh load', async ({ page }) => {
      // Clear localStorage completely and reload
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const importantBtn = page.locator('#importantViewBtn');
      await expect(importantBtn).toHaveClass(/active/);
    });
  });

  test.describe('Filtering', () => {
    test('should show only important items', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await addTodo(page, 'Normal task');
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Important task');
      expect(todoTexts).not.toContain('Normal task');
    });

    test('should not show completed items even if important', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await addTodo(page, 'Important completed');
      await toggleImportant(page, 'Important completed');
      await completeTodo(page, 'Important completed');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Important completed');
    });

    test('should not show sections', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      // Create a section: add a todo, clear it, press Enter
      await addTodo(page, 'x');
      const todoText = page.locator('.todo-item .text').last();
      await todoText.click();
      await todoText.press('Meta+a');
      await todoText.press('Backspace');
      await expect(todoText).toHaveText('', { timeout: 2000 });
      await todoText.press('Enter');
      await page.waitForSelector('.section-header');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const sectionCount = await page.locator('.section-header').count();
      expect(sectionCount).toBe(0);

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Important task');
    });

    test('should not show non-important items', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await addTodo(page, 'Regular task 1');
      await addTodo(page, 'Regular task 2');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toHaveLength(0);
    });
  });

  test.describe('Auto-marking important on creation', () => {
    test('should auto-mark new items as important when created via NewItemInput', async ({ page }) => {
      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      // The new-item input should be visible (empty list)
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('Urgent task');
      await input.press('Enter');

      // Wait for item to appear
      await page.waitForSelector('.todo-item .text:text-is("Urgent task")');

      // Verify the item is in the Important view
      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Urgent task');

      // Verify it's stored as important
      const stored = await getStoredTodos(page);
      const item = stored.find((t: any) => t.text === 'Urgent task');
      expect(item).toBeDefined();
      expect(item.important).toBe(true);
    });

    test('should auto-mark new items as important when created via Enter key', async ({ page }) => {
      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      // Add first item via NewItemInput
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('First urgent');
      await input.press('Enter');

      await page.waitForSelector('.todo-item .text:text-is("First urgent")');

      // Now press Enter on the existing item to create a new one after it
      const existingText = page.locator('.todo-item .text').first();
      await existingText.click();
      await existingText.press('End');
      await existingText.press('Enter');

      // Wait for the new item to appear
      await page.waitForFunction(() => document.querySelectorAll('.todo-item').length >= 2);

      // Type into the new focused item
      const focusedText = page.locator('.todo-item .text:focus');
      await focusedText.pressSequentially('Second urgent');
      await page.locator('body').click({ position: { x: 10, y: 10 } });

      // Verify both items are important
      const stored = await getStoredTodos(page);
      const second = stored.find((t: any) => t.text === 'Second urgent');
      expect(second).toBeDefined();
      expect(second.important).toBe(true);
    });
  });

  test.describe('Removal from view', () => {
    test('should remove item from important view when un-marked as important', async ({ page }) => {
      // Switch to Important view and add an item
      await page.locator('#importantViewBtn').click();

      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('Temporary urgent');
      await input.press('Enter');

      await page.waitForSelector('.todo-item .text:text-is("Temporary urgent")');

      // Un-mark as important
      await toggleImportant(page, 'Temporary urgent');

      // Item should no longer appear in Important view
      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).not.toContain('Temporary urgent');
    });

    test('should still show the item in active view after un-marking', async ({ page }) => {
      // Switch to Important view and add an item
      await page.locator('#importantViewBtn').click();

      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('Was urgent');
      await input.press('Enter');

      await page.waitForSelector('.todo-item .text:text-is("Was urgent")');

      // Un-mark as important
      await toggleImportant(page, 'Was urgent');

      // Switch to Active view
      await page.locator('#activeViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Was urgent');
    });
  });

  test.describe('UI elements', () => {
    test('should show NewItemInput when important view is empty', async ({ page }) => {
      await page.locator('#importantViewBtn').click();

      const newItemInput = page.locator('.new-item');
      await expect(newItemInput).toBeVisible();
    });

    test('should show drag handles in important view', async ({ page }) => {
      await page.locator('#importantViewBtn').click();

      // Add an important item
      const input = page.locator('.new-item .text');
      await input.click();
      await input.pressSequentially('Draggable urgent');
      await input.press('Enter');

      await page.waitForSelector('.todo-item .text:text-is("Draggable urgent")');

      const dragHandle = page.locator('.todo-item .drag-handle').first();
      await expect(dragHandle).toBeVisible();
    });
  });
});
