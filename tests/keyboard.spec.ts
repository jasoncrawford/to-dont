import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getStoredTodos,
} from './helpers';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Arrow Key Navigation', () => {
    test('should navigate down with ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Navigate down
      await firstText.press('ArrowDown');

      // Second item should be focused
      const secondText = page.locator('.todo-item .text').nth(1);
      await expect(secondText).toBeFocused();
    });

    test('should navigate up with ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus second item
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();

      // Navigate up
      await secondText.press('ArrowUp');

      // First item should be focused
      const firstText = page.locator('.todo-item .text').first();
      await expect(firstText).toBeFocused();
    });

    test('should stay at first item when pressing ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await firstText.press('ArrowUp');

      // Should still be focused on first
      await expect(firstText).toBeFocused();
    });

    test('should navigate through sections and todos', async ({ page }) => {
      // Create section
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.fill('Section');
      await sectionText.press('Escape');

      await addTodo(page, 'Task under section');

      // Focus section
      await sectionText.click();

      // Navigate down to todo
      await sectionText.press('ArrowDown');

      const todoText = page.locator('.todo-item .text').first();
      await expect(todoText).toBeFocused();
    });
  });

  test.describe('Cmd+Arrow Navigation', () => {
    test('should jump to first item with Cmd+ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus last item
      const lastText = page.locator('.todo-item .text').last();
      await lastText.click();

      // Jump to first
      await lastText.press('Meta+ArrowUp');

      const firstText = page.locator('.todo-item .text').first();
      await expect(firstText).toBeFocused();
    });

    test('should jump to last item with Cmd+ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Jump to last
      await firstText.press('Meta+ArrowDown');

      const lastText = page.locator('.todo-item .text').last();
      await expect(lastText).toBeFocused();
    });
  });

  test.describe('Enter Key Behavior', () => {
    test('should insert todo below when cursor at end', async ({ page }) => {
      await addTodo(page, 'First');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move cursor to end
      await firstText.press('End');
      await firstText.press('Enter');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);

      // New item should be second
      const texts = await getTodoTexts(page);
      expect(texts[0]).toBe('First');
      expect(texts[1]).toBe('');
    });

    test('should insert todo above when cursor at start', async ({ page }) => {
      await addTodo(page, 'First');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move cursor to start
      await firstText.press('Home');
      await firstText.press('Enter');

      const texts = await getTodoTexts(page);
      expect(texts.length).toBe(2);
      expect(texts[0]).toBe('');
      expect(texts[1]).toBe('First');
    });

    test('should insert newline when cursor in middle', async ({ page }) => {
      await addTodo(page, 'HelloWorld');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Position cursor in middle (after "Hello")
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        const textNode = el.firstChild as Text;
        range.setStart(textNode, 5);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await firstText.press('Enter');

      // Should still be one item with a newline
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toContain('\n');
    });
  });

  test.describe('Escape Key', () => {
    test('should blur input on Escape', async ({ page }) => {
      await addTodo(page, 'Task');

      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await expect(todoText).toBeFocused();

      await todoText.press('Escape');
      await expect(todoText).not.toBeFocused();
    });
  });

  test.describe('Reordering with Keyboard', () => {
    test('should move item up with Cmd+Shift+ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus second item
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();

      // Move up
      await secondText.press('Meta+Shift+ArrowUp');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'First', 'Third']);
    });

    test('should move item down with Cmd+Shift+ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move down
      await firstText.press('Meta+Shift+ArrowDown');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'First', 'Third']);
    });

    test('should not move first item up', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      await firstText.press('Meta+Shift+ArrowUp');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Second']);
    });

    test('should not move last item down', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const lastText = page.locator('.todo-item .text').last();
      await lastText.click();

      await lastText.press('Meta+Shift+ArrowDown');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Second']);
    });
  });

  test.describe('Section Group Reordering', () => {
    test('should move section with its children', async ({ page }) => {
      // Create section with children
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');
      const section1Text = page.locator('.section-header .text').first();
      await section1Text.fill('Section A');
      await section1Text.press('Escape');

      await addTodo(page, 'Task A1');
      await addTodo(page, 'Task A2');

      // Create another section
      await input.click();
      await input.press('Enter');
      const section2Text = page.locator('.section-header .text').last();
      await section2Text.fill('Section B');
      await section2Text.press('Escape');

      await addTodo(page, 'Task B1');

      // Move Section B up
      await section2Text.click();
      await section2Text.press('Meta+Shift+ArrowUp');

      const stored = await getStoredTodos(page);
      // Section B and Task B1 should now be at the top
      expect(stored[0].text).toBe('Section B');
      expect(stored[1].text).toBe('Task B1');
      expect(stored[2].text).toBe('Section A');
    });
  });
});
