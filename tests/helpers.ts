import { Page, expect } from '@playwright/test';
import * as path from 'path';

export const APP_URL = `file://${path.resolve(__dirname, '../index.html')}`;

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
  // Check if there are existing todos
  const todoCount = await page.locator('.todo-item').count();

  if (todoCount === 0) {
    // Use the new-item input when list is empty
    const input = page.locator('.new-item .text');
    await input.click();
    await input.pressSequentially(text);
    await input.press('Enter');
  } else {
    // Add after last item by pressing Enter at the end
    const lastTodo = page.locator('.todo-item').last();
    const lastText = lastTodo.locator('.text');
    await lastText.click();
    await lastText.press('End');
    await lastText.press('Enter');
    // Now fill the new empty item
    const newItem = page.locator('.todo-item').last();
    const newText = newItem.locator('.text');
    await newText.pressSequentially(text);
    await newText.press('Escape');
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

export async function createSection(page: Page, title: string) {
  // Click on new item input, then press Enter to create a section
  const input = page.locator('#newItemInput');
  await input.click();
  await input.press('Enter');

  // Now type the section title
  const lastSection = page.locator('.section-header').last();
  await lastSection.locator('.text').fill(title);
  await lastSection.locator('.text').press('Escape');
}
