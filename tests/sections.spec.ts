import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getSectionTexts,
  getTodoByText,
  getSectionByText,
  getStoredTodos,
} from './helpers';

test.describe('Sections and Hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Creating Sections', () => {
    test('should create section when pressing Enter on empty new item', async ({ page }) => {
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      const sections = await getSectionTexts(page);
      expect(sections.length).toBe(1);

      const stored = await getStoredTodos(page);
      expect(stored[0].type).toBe('section');
    });

    test('should create section at level 2 by default', async ({ page }) => {
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      const section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-2/);

      const stored = await getStoredTodos(page);
      expect(stored[0].level).toBe(2);
    });

    test('should allow typing section title after creation', async ({ page }) => {
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      // Section should be focused for editing
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.fill('My Section');
      await sectionText.press('Escape');

      const stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('My Section');
    });
  });

  test.describe('Section Levels', () => {
    test('should change section to level 1 with Shift+Tab', async ({ page }) => {
      // Create a section
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.fill('Top Level');
      await sectionText.press('Shift+Tab');

      const section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-1/);

      const stored = await getStoredTodos(page);
      expect(stored[0].level).toBe(1);
    });

    test('should change section to level 2 with Tab', async ({ page }) => {
      // Create a section at level 1
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.fill('Section');
      await sectionText.press('Shift+Tab'); // Make it level 1
      await sectionText.press('Tab'); // Back to level 2

      const section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-2/);
    });
  });

  test.describe('Todo Indentation', () => {
    test('should indent todo with Tab', async ({ page }) => {
      await addTodo(page, 'Indented task');

      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await todoText.press('Tab');

      const todo = page.locator('.todo-item').first();
      await expect(todo).toHaveClass(/indented/);

      const stored = await getStoredTodos(page);
      expect(stored[0].indented).toBe(true);
    });

    test('should unindent todo with Shift+Tab', async ({ page }) => {
      await addTodo(page, 'Task to unindent');

      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await todoText.press('Tab'); // indent
      await todoText.press('Shift+Tab'); // unindent

      const todo = page.locator('.todo-item').first();
      await expect(todo).not.toHaveClass(/indented/);
    });
  });

  test.describe('Section with Todos', () => {
    test('should group todos under sections', async ({ page }) => {
      // Create a section
      const input = page.locator('#newItemInput');
      await input.click();
      await input.press('Enter');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.fill('Work');
      await sectionText.press('Escape');

      // Add todos after the section
      await addTodo(page, 'Task 1');
      await addTodo(page, 'Task 2');

      // Create another section
      await input.click();
      await input.press('Enter');
      const section2Text = page.locator('.section-header .text').last();
      await section2Text.fill('Personal');
      await section2Text.press('Escape');

      await addTodo(page, 'Task 3');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(5);
      expect(stored[0].type).toBe('section');
      expect(stored[0].text).toBe('Work');
      expect(stored[1].text).toBe('Task 1');
      expect(stored[2].text).toBe('Task 2');
      expect(stored[3].type).toBe('section');
      expect(stored[3].text).toBe('Personal');
      expect(stored[4].text).toBe('Task 3');
    });
  });

  test.describe('Converting Items', () => {
    test('should convert empty todo to section on Enter', async ({ page }) => {
      await addTodo(page, 'Regular task');

      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await todoText.fill(''); // Clear the text
      await todoText.press('Enter');

      // Should now be a section
      const sections = page.locator('.section-header');
      await expect(sections).toHaveCount(1);

      const todos = page.locator('.todo-item');
      await expect(todos).toHaveCount(0);

      const stored = await getStoredTodos(page);
      expect(stored[0].type).toBe('section');
    });
  });
});
