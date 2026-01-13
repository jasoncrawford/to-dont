import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoByText,
  toggleImportant,
  enableTestMode,
  setVirtualTime,
} from './helpers';

test.describe('Decay and Fade Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Fade Effect', () => {
    test('should start with full opacity for new items', async ({ page }) => {
      await addTodo(page, 'Fresh task');

      const todo = await getTodoByText(page, 'Fresh task');
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      expect(opacity).toBeCloseTo(1, 1);
    });

    test('should fade items over time using virtual time', async ({ page }) => {
      await addTodo(page, 'Aging task');

      // Advance virtual time by 7 days
      await setVirtualTime(page, 7);

      const todo = await getTodoByText(page, 'Aging task');
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      // Should be faded but not completely (7/14 days = ~50%)
      expect(opacity).toBeLessThan(0.8);
      expect(opacity).toBeGreaterThan(0.3);
    });

    test('should reach minimum opacity at 14 days', async ({ page }) => {
      await addTodo(page, 'Old task');

      // Advance virtual time by 14 days
      await setVirtualTime(page, 14);

      const todo = await getTodoByText(page, 'Old task');
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      // Should be at minimum opacity (0.2)
      expect(opacity).toBeCloseTo(0.2, 1);
    });
  });

  test.describe('Important Escalation', () => {
    test('should not fade important items', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      // Advance virtual time
      await setVirtualTime(page, 10);

      const todo = await getTodoByText(page, 'Important task');
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      // Important items don't fade
      expect(opacity).toBeCloseTo(1, 1);
    });

    test('should apply importance level 1 styling after 3 days', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      await setVirtualTime(page, 4);

      const todo = await getTodoByText(page, 'Important task');
      await expect(todo).toHaveClass(/important-level-1/);
    });

    test('should apply importance level 2 styling after 5 days', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      await setVirtualTime(page, 6);

      const todo = await getTodoByText(page, 'Important task');
      await expect(todo).toHaveClass(/important-level-2/);
    });

    test('should apply importance level 3 styling after 7 days', async ({ page }) => {
      await addTodo(page, 'Important task');
      await toggleImportant(page, 'Important task');

      await setVirtualTime(page, 8);

      const todo = await getTodoByText(page, 'Important task');
      await expect(todo).toHaveClass(/important-level-3/);
    });
  });

  test.describe('Virtual Time', () => {
    test('should use virtual time for new items in test mode', async ({ page }) => {
      // Set virtual time to 5 days ahead
      await setVirtualTime(page, 5);

      await addTodo(page, 'Future task');

      // The task should be created at virtual time, so it should appear fresh
      const todo = await getTodoByText(page, 'Future task');
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      expect(opacity).toBeCloseTo(1, 1);
    });

    test('should reset to day 0 when reset clicked', async ({ page }) => {
      await setVirtualTime(page, 10);

      // Verify we're at day 10
      let timeDisplay = await page.locator('#timeDisplay').textContent();
      expect(timeDisplay).toBe('Day 10');

      // Reset
      await page.locator('#resetTime').click();

      // Verify we're at day 0
      timeDisplay = await page.locator('#timeDisplay').textContent();
      expect(timeDisplay).toBe('Day 0');
    });
  });

  test.describe('Completed Items', () => {
    test('should not fade completed items', async ({ page }) => {
      await addTodo(page, 'Completed task');

      // Complete it
      const todo = await getTodoByText(page, 'Completed task');
      await todo.locator('.checkbox').click();

      // Advance time
      await setVirtualTime(page, 10);

      // Should have full opacity (completed styling overrides fade)
      const opacity = await todo.evaluate((el) => {
        return parseFloat(window.getComputedStyle(el).opacity);
      });

      expect(opacity).toBeCloseTo(1, 1);
    });
  });
});
