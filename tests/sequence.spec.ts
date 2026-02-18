import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getStoredTodos,
  completeTodo,
} from './helpers';

test.describe('Sequence Items', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Arrow Splitting', () => {
    test('should split on -> when completing', async ({ page }) => {
      await addTodo(page, 'A -> B');

      await completeTodo(page, 'A -> B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('A');
      expect(stored[0].completed).toBe(true);
      expect(stored[1].text).toBe('B');
      expect(stored[1].completed).toBe(false);
    });

    test('should split on --> when completing', async ({ page }) => {
      await addTodo(page, 'First --> Second');

      await completeTodo(page, 'First --> Second');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('First');
      expect(stored[0].completed).toBe(true);
      expect(stored[1].text).toBe('Second');
      expect(stored[1].completed).toBe(false);
    });

    test('should split on Unicode arrow → when completing', async ({ page }) => {
      await addTodo(page, 'Start → End');

      await completeTodo(page, 'Start → End');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Start');
      expect(stored[0].completed).toBe(true);
      expect(stored[1].text).toBe('End');
      expect(stored[1].completed).toBe(false);
    });

    test('should only split on first arrow with multiple arrows', async ({ page }) => {
      await addTodo(page, 'A -> B -> C');

      await completeTodo(page, 'A -> B -> C');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('A');
      expect(stored[0].completed).toBe(true);
      expect(stored[1].text).toBe('B -> C');
      expect(stored[1].completed).toBe(false);
    });

    test('should handle chain of three items through multiple completions', async ({ page }) => {
      await addTodo(page, 'X -> Y -> Z');

      // Complete first time: X -> Y -> Z becomes [x] X and [ ] Y -> Z
      await completeTodo(page, 'X -> Y -> Z');

      let stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('X');
      expect(stored[1].text).toBe('Y -> Z');

      // Complete second time: Y -> Z becomes [x] Y and [ ] Z
      await completeTodo(page, 'Y -> Z');

      stored = await getStoredTodos(page);
      expect(stored.length).toBe(3);
      expect(stored[0].text).toBe('X');
      expect(stored[0].completed).toBe(true);
      expect(stored[1].text).toBe('Y');
      expect(stored[1].completed).toBe(true);
      expect(stored[2].text).toBe('Z');
      expect(stored[2].completed).toBe(false);
    });
  });

  test.describe('Non-Sequence Items', () => {
    test('should not split items without arrows', async ({ page }) => {
      await addTodo(page, 'Regular task');

      await completeTodo(page, 'Regular task');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('Regular task');
      expect(stored[0].completed).toBe(true);
    });

    test('should not split on single dash', async ({ page }) => {
      await addTodo(page, 'A - B');

      await completeTodo(page, 'A - B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('A - B');
      expect(stored[0].completed).toBe(true);
    });

    test('should not split on greater than alone', async ({ page }) => {
      await addTodo(page, 'A > B');

      await completeTodo(page, 'A > B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('A &gt; B');
      expect(stored[0].completed).toBe(true);
    });
  });

  test.describe('Edge Cases', () => {
    test('should not split if nothing before arrow', async ({ page }) => {
      await addTodo(page, '-> B');

      await completeTodo(page, '-> B');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('-&gt; B');
      expect(stored[0].completed).toBe(true);
    });

    test('should not split if nothing after arrow', async ({ page }) => {
      await addTodo(page, 'A ->');

      await completeTodo(page, 'A ->');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('A -&gt;');
      expect(stored[0].completed).toBe(true);
    });

    test('should preserve indentation on new item', async ({ page }) => {
      await addTodo(page, 'A -> B');

      // Indent the item
      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await todoText.press('Tab');

      // Now complete it
      const checkbox = page.locator('.todo-item .checkbox').first();
      await checkbox.click();

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].indented).toBe(true);
      expect(stored[1].indented).toBe(true);
    });

    test('should insert new item right after completed item', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'A -> B');
      await addTodo(page, 'Last');

      await completeTodo(page, 'A -> B');

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'A', 'B', 'Last']);
    });
  });
});
