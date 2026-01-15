import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getStoredTodos,
  createSection,
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
      await createSection(page, 'Section');

      await addTodo(page, 'Task under section');

      // Focus section
      const sectionText = page.locator('.section-header .text').first();
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

    test('should split todo into two when cursor in middle', async ({ page }) => {
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

      // Should now be two items
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Hello');
      expect(stored[1].text).toBe('World');
    });
  });

  test.describe('Backspace Key Behavior', () => {
    test('should merge with previous item when backspace at start', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      // Focus second item and position cursor at start
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await page.evaluate(() => {
        const el = document.querySelectorAll('.todo-item .text')[1] as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild || el, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await secondText.press('Backspace');

      // Should now be one item with merged text
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('HelloWorld');
    });

    test('should not merge if cursor is not at start', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      // Focus second item and add text at end, then backspace (ensures cursor not at start)
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await secondText.press('End');
      await page.keyboard.type('X');
      await page.waitForTimeout(50);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(50);

      // Should still be two items (no merge happened)
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Hello');
      expect(stored[1].text).toBe('World');
    });

    test('should not merge first item with nothing', async ({ page }) => {
      await addTodo(page, 'Only item');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild || el, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await firstText.press('Backspace');

      // Should still be one item, unchanged
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('Only item');
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

    test('should preserve unsaved text when moving up', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus second item and type new text without blurring
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await secondText.press('End');
      await page.keyboard.type(' modified');

      // Move up immediately (before blur saves)
      await page.keyboard.press('Meta+Shift+ArrowUp');

      // Text should be preserved
      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second modified', 'First']);
    });

    test('should preserve unsaved text when moving down', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus first item and type new text without blurring
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await firstText.press('End');
      await page.keyboard.type(' modified');

      // Move down immediately (before blur saves)
      await page.keyboard.press('Meta+Shift+ArrowDown');

      // Text should be preserved
      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'First modified']);
    });
  });

});
