import { test, expect } from '@playwright/test';
import { APP_URL } from './helpers';

test.describe('Issue 53: first item Enter focuses new todo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.new-item', { state: 'visible' });
  });

  test('Enter in NewItemInput creates item and focuses it', async ({ page }) => {
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('Test item');
    await page.keyboard.press('Enter');

    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 3000 });

    // Focus must be on the todo item's text, not on NewItemInput
    const focusState = await page.evaluate(() => ({
      inTodo: !!document.activeElement?.closest('.todo-item'),
      inNew: !!document.activeElement?.closest('.new-item'),
    }));
    expect(focusState.inTodo).toBe(true);
    expect(focusState.inNew).toBe(false);

    // Second Enter should create a second item
    await page.keyboard.press('Enter');
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 3000 });
  });

  test('Enter works with simulated sync re-renders', async ({ page }) => {
    // Simulate sync layer causing frequent re-renders
    await page.evaluate(() => {
      (window as any).__renderInterval = setInterval(() => window.render(), 50);
    });

    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('Test item');
    await page.keyboard.press('Enter');

    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 3000 });

    const focusState = await page.evaluate(() => ({
      inTodo: !!document.activeElement?.closest('.todo-item'),
    }));
    expect(focusState.inTodo).toBe(true);

    await page.waitForTimeout(300);

    // Focus should persist after re-renders
    const focusState2 = await page.evaluate(() => ({
      inTodo: !!document.activeElement?.closest('.todo-item'),
    }));
    expect(focusState2.inTodo).toBe(true);

    // Second Enter
    await page.keyboard.press('Enter');
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 3000 });

    await page.evaluate(() => clearInterval((window as any).__renderInterval));
  });
});
