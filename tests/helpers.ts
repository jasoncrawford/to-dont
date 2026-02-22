import { Page, expect } from '@playwright/test';

// Meta on macOS, Control on Linux/Windows
export const CMD = process.platform === 'darwin' ? 'Meta' : 'Control';

export const APP_URL = 'http://localhost:8173/?test-mode=1';

export async function setupPage(page: Page) {
  // Clear localStorage before each test
  await page.goto(APP_URL);
  await page.evaluate(() => {
    localStorage.clear();
    // Set default view to active for existing tests (default is now 'important')
    localStorage.setItem('decay-todos-view-mode', 'active');
  });
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
    // Enter creates the text item + an empty item below, with focus on the empty item
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially(text);
    await input.press('Enter');
    // Delete the trailing empty item so tests see clean state
    // The empty item is focused, so Backspace at position 0 merges it away
    await page.keyboard.press('Backspace');
    await expect(page.locator('.todo-item')).toHaveCount(1, { timeout: 2000 });
  } else {
    // Check if there's already an empty, focused todo we can type into
    // (e.g. left over from NewItemInput or a previous Enter)
    const focusedText = page.locator('.todo-item .text:focus');
    const hasFocusedEmpty = await focusedText.count() > 0 &&
      (await focusedText.textContent()) === '';

    if (hasFocusedEmpty) {
      // Type directly into the already-focused empty item
      await focusedText.pressSequentially(text);
    } else {
      // Add after last item by pressing Enter at the end
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
      const newFocused = page.locator('.todo-item .text:focus');
      await newFocused.pressSequentially(text);
    }

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

export async function createSection(page: Page, title: string = '') {
  // First add a placeholder todo
  await addTodo(page, 'x');

  // Click the 'x' item, clear its text, and convert to section
  const xItem = page.locator('.todo-item .text:text-is("x")').last();
  await xItem.click();

  // Select all and delete to clear the text
  await page.keyboard.press(`${CMD}+a`);
  await page.keyboard.press('Backspace');

  // Wait for text to be empty (use the focused element since the text locator no longer matches)
  await page.waitForFunction(
    () => document.activeElement?.textContent === '',
    { timeout: 2000 }
  );

  // Press Enter to convert to section
  await page.keyboard.press('Enter');

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
