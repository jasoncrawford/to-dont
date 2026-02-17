import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoByText,
  completeTodo,
  toggleImportant,
} from './helpers';
import { createSection } from './helpers';

test.describe('Dark Mode', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('respects prefers-color-scheme: dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    // Wait for styles to apply
    await page.waitForTimeout(100);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toBe('rgb(18, 18, 18)'); // #121212
  });

  test('uses light mode by default', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(100);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    expect(bgColor).toBe('rgb(255, 255, 255)'); // white
  });

  test('text is light-colored in dark mode', async ({ page }) => {
    await addTodo(page, 'Dark mode todo');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);

    const textColor = await page.locator('.todo-item .text').first().evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // Text should be light (R, G, B all above 180)
    const match = textColor.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(match).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(180);
    expect(b).toBeGreaterThan(180);
  });

  test('important items use readable red in dark mode', async ({ page }) => {
    await addTodo(page, 'Urgent task');
    await toggleImportant(page, 'Urgent task');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);

    const todoItem = await getTodoByText(page, 'Urgent task');
    const textColor = await todoItem.locator('.text').evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // Should be a bright red — R channel high, G and B lower
    const match = textColor.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(match).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    expect(r).toBeGreaterThan(200); // Bright red
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(120);
  });

  test('section headers are readable in dark mode', async ({ page }) => {
    await createSection(page, 'My Section');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);

    const sectionColor = await page.locator('.section-header .text').first().evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // Section text should be light enough to read
    const match = sectionColor.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(match).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeGreaterThan(150);
  });

  test('view tabs are readable in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);

    const activeTabColor = await page.locator('.view-tab.active').evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // Active tab text should be light
    const match = activeTabColor.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(match).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(180);
    expect(b).toBeGreaterThan(180);
  });

  test('completed items are styled correctly in dark mode', async ({ page }) => {
    await addTodo(page, 'Done task');
    await completeTodo(page, 'Done task');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);

    const todoItem = await getTodoByText(page, 'Done task');
    const textColor = await todoItem.locator('.text').evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // Completed text should still be visible (not black-on-dark)
    const match = textColor.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(match).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    // Should be at least medium brightness
    expect(r).toBeGreaterThan(100);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });
});
