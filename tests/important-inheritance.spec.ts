import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getStoredTodos,
  toggleImportant,
  completeTodo,
} from './helpers';

test.describe('Important flag inheritance', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Splitting with Enter', () => {
    test('should inherit important when splitting an important item', async ({ page }) => {
      await addTodo(page, 'HelloWorld');
      await toggleImportant(page, 'HelloWorld');

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

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Hello');
      expect(stored[0].important).toBe(true);
      expect(stored[1].text).toBe('World');
      expect(stored[1].important).toBe(true);
    });

    test('should not set important when splitting a non-important item', async ({ page }) => {
      await addTodo(page, 'HelloWorld');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

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

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[1].important).toBeFalsy();
    });
  });

  test.describe('Arrow completion', () => {
    test('should inherit important when completing an important arrow item', async ({ page }) => {
      await addTodo(page, 'A -> B');
      await toggleImportant(page, 'A -> B');

      await completeTodo(page, 'A -> B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('A');
      expect(stored[0].important).toBe(true);
      expect(stored[1].text).toBe('B');
      expect(stored[1].important).toBe(true);
    });

    test('should not set important when completing a non-important arrow item', async ({ page }) => {
      await addTodo(page, 'A -> B');

      await completeTodo(page, 'A -> B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[1].important).toBeFalsy();
    });
  });
});
