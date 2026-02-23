import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getSectionTexts,
  getTodoByText,
  completeTodo,
  toggleImportant,
  getStoredTodos,
  createSection,
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

    test('should show completed items if important', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await addTodo(page, 'Important completed');
      await toggleImportant(page, 'Important completed');
      await completeTodo(page, 'Important completed');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Important completed');
    });

    test('should only show sections that have important items under them', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      // Create section "Work" with one important and one normal item
      await createSection(page, 'Work');
      await addTodo(page, 'Important work task');
      await toggleImportant(page, 'Important work task');
      await addTodo(page, 'Normal work task');

      // Create section "Personal" with no important items
      await createSection(page, 'Personal');
      await addTodo(page, 'Normal personal task');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      // Work section should be visible (it has an important item)
      const sectionTexts = await getSectionTexts(page);
      expect(sectionTexts).toContain('Work');

      // Personal section should NOT be visible (no important items)
      expect(sectionTexts).not.toContain('Personal');

      // Only the important item should show
      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Important work task');
      expect(todoTexts).not.toContain('Normal work task');
      expect(todoTexts).not.toContain('Normal personal task');
    });

    test('should show section headers when they have important items under them', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      await createSection(page, 'Work');
      await addTodo(page, 'Urgent deadline');
      await toggleImportant(page, 'Urgent deadline');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const sectionTexts = await getSectionTexts(page);
      expect(sectionTexts).toContain('Work');

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Urgent deadline');
    });

    test('should hide sections with no important items under them', async ({ page }) => {
      // Switch to active view to add items
      await page.locator('#activeViewBtn').click();

      // Section with only normal items
      await createSection(page, 'Work');
      await addTodo(page, 'Normal work item');

      // Section with an important item
      await createSection(page, 'Personal');
      await addTodo(page, 'Important personal item');
      await toggleImportant(page, 'Important personal item');

      // Switch to Important view
      await page.locator('#importantViewBtn').click();

      const sectionTexts = await getSectionTexts(page);
      expect(sectionTexts).not.toContain('Work');
      expect(sectionTexts).toContain('Personal');
    });

    test('should show level 1 section when a level 2 subsection has important items', async ({ page }) => {
      // Set up precise tree structure via events
      const now = Date.now();
      await page.evaluate(({ now }: { now: number }) => {
        const events = [
          { id: crypto.randomUUID(), itemId: 'l1', type: 'item_created', field: null,
            value: { text: 'Projects', position: 'f', type: 'section', level: 1, parentId: null },
            timestamp: now, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'l2', type: 'item_created', field: null,
            value: { text: 'Backend', position: 'a', type: 'section', level: 2, parentId: 'l1' },
            timestamp: now + 1, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'item-1', type: 'item_created', field: null,
            value: { text: 'Fix critical bug', position: 'a', parentId: 'l2', important: true },
            timestamp: now + 2, clientId: 'test' },
        ];
        localStorage.setItem('decay-events', JSON.stringify(events));
        localStorage.setItem('decay-todos-view-mode', 'important');
      }, { now });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const sectionTexts = await getSectionTexts(page);
      // Both L1 and L2 sections should be visible
      expect(sectionTexts).toContain('Projects');
      expect(sectionTexts).toContain('Backend');

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Fix critical bug');
    });

    test('should hide empty level 2 sections under a level 1 with important items elsewhere', async ({ page }) => {
      // Set up precise tree structure via events
      const now = Date.now();
      await page.evaluate(({ now }: { now: number }) => {
        const events = [
          { id: crypto.randomUUID(), itemId: 'l1', type: 'item_created', field: null,
            value: { text: 'Projects', position: 'f', type: 'section', level: 1, parentId: null },
            timestamp: now, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'l2-backend', type: 'item_created', field: null,
            value: { text: 'Backend', position: 'a', type: 'section', level: 2, parentId: 'l1' },
            timestamp: now + 1, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'item-backend', type: 'item_created', field: null,
            value: { text: 'Normal backend task', position: 'a', parentId: 'l2-backend' },
            timestamp: now + 2, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'l2-frontend', type: 'item_created', field: null,
            value: { text: 'Frontend', position: 'n', type: 'section', level: 2, parentId: 'l1' },
            timestamp: now + 3, clientId: 'test' },
          { id: crypto.randomUUID(), itemId: 'item-frontend', type: 'item_created', field: null,
            value: { text: 'Important frontend task', position: 'a', parentId: 'l2-frontend', important: true },
            timestamp: now + 4, clientId: 'test' },
        ];
        localStorage.setItem('decay-events', JSON.stringify(events));
        localStorage.setItem('decay-todos-view-mode', 'important');
      }, { now });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const sectionTexts = await getSectionTexts(page);
      // Projects (L1) should show because Frontend has important items
      expect(sectionTexts).toContain('Projects');
      // Frontend should show (has important item)
      expect(sectionTexts).toContain('Frontend');
      // Backend should NOT show (no important items)
      expect(sectionTexts).not.toContain('Backend');

      const todoTexts = await getTodoTexts(page);
      expect(todoTexts).toContain('Important frontend task');
      expect(todoTexts).not.toContain('Normal backend task');
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
