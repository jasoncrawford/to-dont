import { test, expect } from '@playwright/test';
import { APP_URL } from './helpers';

test.describe('Issue 53: first item Enter creates new line', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.new-item', { state: 'visible' });
  });

  test('Enter in NewItemInput creates item AND empty line below', async ({ page }) => {
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('First item');
    await page.keyboard.press('Enter');

    // Should have TWO items: the typed one and an empty one
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 3000 });

    const texts = await page.locator('.todo-item .text').allTextContents();
    expect(texts[0]).toBe('First item');
    expect(texts[1]).toBe('');

    // Focus should be on the second (empty) item
    const focusState = await page.evaluate(() => {
      const items = document.querySelectorAll('.todo-item');
      const focused = document.activeElement?.closest('.todo-item');
      return {
        focusedIndex: focused ? Array.from(items).indexOf(focused) : -1,
      };
    });
    expect(focusState.focusedIndex).toBe(1);
  });

  test('can type immediately on the new line', async ({ page }) => {
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('First item');
    await page.keyboard.press('Enter');

    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 3000 });

    // Type on the new empty line
    await page.keyboard.type('Second item');

    const texts = await page.locator('.todo-item .text').allTextContents();
    expect(texts[0]).toBe('First item');
    expect(texts[1]).toBe('Second item');
  });

  test('Enter on the new line creates a third item', async ({ page }) => {
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially('First item');
    await page.keyboard.press('Enter');

    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 3000 });

    // Type second item and press Enter
    await page.keyboard.type('Second item');
    await page.keyboard.press('Enter');

    await expect(page.locator('.todo-item')).toHaveCount(3, { timeout: 3000 });
    const texts = await page.locator('.todo-item .text').allTextContents();
    expect(texts[0]).toBe('First item');
    expect(texts[1]).toBe('Second item');
    expect(texts[2]).toBe('');
  });
});
