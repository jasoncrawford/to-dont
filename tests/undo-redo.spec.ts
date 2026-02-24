import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  completeTodo,
  toggleImportant,
  deleteTodo,
  createSection,
  getSectionTexts,
  CMD,
} from './helpers';

test.describe('Undo/Redo', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('should undo delete via button', async ({ page }) => {
    await addTodo(page, 'First');
    await addTodo(page, 'Second');

    // Delete "Second" via button
    await deleteTodo(page, 'Second');
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });

    // Undo should bring it back
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 2000 });
    expect(await getTodoTexts(page)).toEqual(['First', 'Second']);
  });

  test('should redo after undo of delete', async ({ page }) => {
    await addTodo(page, 'First');
    await addTodo(page, 'Second');

    // Delete, undo, then redo
    await deleteTodo(page, 'Second');
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });

    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 2000 });

    await page.keyboard.press(`${CMD}+Shift+z`);
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });
    expect(await getTodoTexts(page)).toEqual(['First']);
  });

  test('should undo toggle complete', async ({ page }) => {
    await addTodo(page, 'My task');

    // Complete it
    await completeTodo(page, 'My task');
    await expect(page.locator('.todo-item.completed')).toHaveCount(1);

    // Undo should uncomplete it
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item.completed')).toHaveCount(0, { timeout: 2000 });
  });

  test('should undo toggle important', async ({ page }) => {
    await addTodo(page, 'My task');

    // Mark important
    await toggleImportant(page, 'My task');
    await expect(page.locator('.important-btn.active')).toHaveCount(1);

    // Undo
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.important-btn.active')).toHaveCount(0, { timeout: 2000 });
  });

  test('should undo text change via blur', async ({ page }) => {
    await addTodo(page, 'Original');

    // Click into item and modify text
    const textEl = page.locator('.todo-item .text').first();
    await textEl.click();
    await textEl.press('End');
    await textEl.pressSequentially(' modified');

    // Blur to save
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.todo-item .text').first()).toHaveText('Original modified');

    // Undo should revert text
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item .text').first()).toHaveText('Original', { timeout: 2000 });
  });

  test('should undo Enter that creates a new line', async ({ page }) => {
    await addTodo(page, 'Hello');

    // Focus the item and press Enter at end to create a new empty item
    const textEl = page.locator('.todo-item .text').first();
    await textEl.click();
    await textEl.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 2000 });

    // Undo should remove the new line
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });
  });

  test('should undo backspace merge', async ({ page }) => {
    await addTodo(page, 'First');
    await addTodo(page, 'Second');

    // Focus start of "Second" and press Backspace
    const secondText = page.locator('.todo-item .text').nth(1);
    await secondText.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');

    // Should be merged into one item
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });
    await expect(page.locator('.todo-item .text').first()).toHaveText('FirstSecond');

    // Undo should restore both items
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 2000 });
    expect(await getTodoTexts(page)).toEqual(['First', 'Second']);
  });

  test('should undo move item up', async ({ page }) => {
    await addTodo(page, 'First');
    await addTodo(page, 'Second');
    await addTodo(page, 'Third');

    // Focus third item and move it up
    const thirdText = page.locator('.todo-item .text').nth(2);
    await thirdText.click();
    await page.keyboard.press(`${CMD}+Shift+ArrowUp`);
    expect(await getTodoTexts(page)).toEqual(['First', 'Third', 'Second']);

    // Undo should restore original order
    await page.keyboard.press(`${CMD}+z`);
    await page.waitForTimeout(200);
    expect(await getTodoTexts(page)).toEqual(['First', 'Second', 'Third']);
  });

  test('should undo archive completed', async ({ page }) => {
    await addTodo(page, 'Keep');
    await addTodo(page, 'Archive me');

    // Complete and archive
    await completeTodo(page, 'Archive me');
    await page.locator('#archiveCompletedBtn').click();

    // Only active item visible
    expect(await getTodoTexts(page)).toEqual(['Keep']);

    // Undo the archive
    await page.keyboard.press(`${CMD}+z`);
    await page.waitForTimeout(200);
    expect(await getTodoTexts(page)).toHaveLength(2);
  });

  test('should clear redo stack on new action', async ({ page }) => {
    await addTodo(page, 'First');
    await addTodo(page, 'Second');

    // Delete "Second"
    await deleteTodo(page, 'Second');
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });

    // Undo
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(2, { timeout: 2000 });

    // Delete "First" (new action clears redo)
    await deleteTodo(page, 'First');
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });

    // Redo should not re-delete Second (redo stack was cleared)
    await page.keyboard.press(`${CMD}+Shift+z`);
    await page.waitForTimeout(200);
    expect(await getTodoTexts(page)).toEqual(['Second']);
  });

  test('should handle multiple undos in sequence', async ({ page }) => {
    await addTodo(page, 'First');

    // Delete it
    await deleteTodo(page, 'First');
    await expect(page.locator('.todo-item')).toHaveCount(0, { timeout: 2000 });

    // Undo delete
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });

    // Redo delete
    await page.keyboard.press(`${CMD}+Shift+z`);
    await expect(page.locator('.todo-item')).toHaveCount(0, { timeout: 2000 });

    // Undo delete again
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });
    expect(await getTodoTexts(page)).toEqual(['First']);
  });

  test('should undo indent with Tab', async ({ page }) => {
    await addTodo(page, 'Item');

    // Focus and press Tab to indent
    const textEl = page.locator('.todo-item .text').first();
    await textEl.click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.todo-item.indented')).toHaveCount(1);

    // Undo should un-indent
    await page.keyboard.press(`${CMD}+z`);
    await expect(page.locator('.todo-item.indented')).toHaveCount(0, { timeout: 2000 });
  });
});
