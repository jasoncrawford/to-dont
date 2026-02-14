import { Page, expect } from '@playwright/test';

export const APP_URL = 'http://localhost:5173/?test-mode=1';

export async function setupPage(page: Page) {
  // Clear localStorage before each test
  await page.goto(APP_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Wait for the new item input to be ready (should be visible when list is empty)
  await page.waitForSelector('.new-item', { state: 'visible' });
}

export async function addTodo(page: Page, text: string) {
  // Check if there are existing items (todos or sections)
  const todoCount = await page.locator('.todo-item').count();
  const sectionCount = await page.locator('.section-header').count();
  const totalCount = todoCount + sectionCount;

  if (totalCount === 0) {
    // Use the new-item input when list is empty
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially(text);
    await input.press('Enter');
  } else {
    // Add after last item by pressing Enter at the end
    // Get the last item (could be todo or section)
    const lastItem = page.locator('.todo-item, .section-header').last();
    const lastText = lastItem.locator('.text');
    await lastText.click();
    await lastText.press('End');
    await lastText.press('Enter');

    // Wait for the new todo to be created and focused
    await page.waitForFunction(
      (expected) => {
        const count = document.querySelectorAll('.todo-item').length + document.querySelectorAll('.section-header').length;
        const hasFocus = document.querySelector('.todo-item .text:focus') !== null;
        return count >= expected && hasFocus;
      },
      totalCount + 1
    );

    // Find the focused element (should be the new empty todo)
    const focusedText = page.locator('.todo-item .text:focus');
    await focusedText.pressSequentially(text);

    // Click elsewhere to blur and save the text
    await page.locator('body').click({ position: { x: 10, y: 10 } });
  }
  // Wait for the new item to appear
  await page.waitForSelector(`.todo-item .text:text-is("${text}")`);
}

export async function getTodoTexts(page: Page): Promise<string[]> {
  return page.locator('.todo-item .text').allTextContents();
}

export async function getSectionTexts(page: Page): Promise<string[]> {
  return page.locator('.section-header .text').allTextContents();
}

export async function getTodoByText(page: Page, text: string) {
  return page.locator(`.todo-item:has(.text:text("${text}"))`);
}

export async function getSectionByText(page: Page, text: string) {
  return page.locator(`.section-header:has(.text:text("${text}"))`);
}

export async function completeTodo(page: Page, text: string) {
  const todo = await getTodoByText(page, text);
  await todo.locator('.checkbox').click();
}

export async function toggleImportant(page: Page, text: string) {
  const todo = await getTodoByText(page, text);
  await todo.hover();
  await todo.locator('.important-btn').click();
}

export async function deleteTodo(page: Page, text: string) {
  const todo = await getTodoByText(page, text);
  await todo.hover();
  // Delete button has × text, no specific class
  await todo.locator('.actions button:has-text("×")').click();
}

// Note: There's no manual archive button in the UI.
// Items are auto-archived when they're 14+ days old.
// This function uses time advancement to trigger auto-archive.
export async function archiveByTime(page: Page, text: string) {
  // Advance time by 14 days to trigger auto-archive
  await setVirtualTime(page, 14);
}

export async function getStoredTodos(page: Page) {
  return page.evaluate(() => {
    const stored = localStorage.getItem('decay-todos');
    return stored ? JSON.parse(stored) : [];
  });
}

export async function setVirtualTime(page: Page, daysOffset: number) {
  // First reset to day 0, then advance to desired day
  await page.locator('#resetTime').click();
  for (let i = 0; i < daysOffset; i++) {
    await page.locator('#advanceDay').click();
  }
}

export async function enableTestMode(page: Page) {
  // Test mode is always enabled via the +1 day / reset buttons
  // Just reset to ensure we're at a known state
  await page.locator('#resetTime').click();
}

export async function createSection(page: Page, title: string = '') {
  // First add a placeholder todo
  await addTodo(page, 'x');

  // Get the todo we just added (it's the last one)
  const todoText = page.locator('.todo-item .text').last();
  await todoText.click();

  // Select all and delete to clear the text
  await todoText.press('Meta+a');
  await todoText.press('Backspace');

  // Wait for the text to be cleared
  await expect(todoText).toHaveText('', { timeout: 2000 });

  // Press Enter to convert to section
  await todoText.press('Enter');

  // Wait for section to appear
  await page.waitForSelector('.section-header');

  // If title provided, fill it in
  if (title) {
    const sectionText = page.locator('.section-header .text').last();
    await sectionText.click();
    await sectionText.pressSequentially(title);

    // Blur to save
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.section-header .text').last()).toHaveText(title);
  }
}
