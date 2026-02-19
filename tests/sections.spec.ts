import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getSectionTexts,
  getStoredTodos,
  createSection,
  CMD,
} from './helpers';

test.describe('Sections and Hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Creating Sections', () => {
    test('should convert empty todo to section on Enter', async ({ page }) => {
      // Add a todo first
      await addTodo(page, 'Will become section');

      // Click on the todo text and clear it
      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();

      // Clear the text using keyboard
      await todoText.press(`${CMD}+a`);
      await todoText.press('Backspace');

      // Wait for the text to be cleared
      await expect(todoText).toHaveText('', { timeout: 2000 });

      // Press Enter to convert to section
      await todoText.press('Enter');

      // Should now be a section
      const sections = page.locator('.section-header');
      await expect(sections).toHaveCount(1);

      const todos = page.locator('.todo-item');
      await expect(todos).toHaveCount(0);

      const stored = await getStoredTodos(page);
      expect(stored[0].type).toBe('section');
    });

    test('should create section at level 2 by default', async ({ page }) => {
      await createSection(page);

      const section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-2/);

      const stored = await getStoredTodos(page);
      expect(stored[0].level).toBe(2);
    });

    test('should allow setting section title', async ({ page }) => {
      await createSection(page, 'My Section');

      const stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('My Section');
    });
  });

  test.describe('Section Levels', () => {
    test('should change section to level 1 with Shift+Tab', async ({ page }) => {
      await createSection(page, 'Top Level');

      // Focus the section text
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('Shift+Tab');

      const section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-1/);

      const stored = await getStoredTodos(page);
      expect(stored[0].level).toBe(1);
    });

    test('should change section to level 2 with Tab', async ({ page }) => {
      await createSection(page, 'Section');

      // Focus the section text and change to level 1 first
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('Shift+Tab'); // Make it level 1

      let section = page.locator('.section-header').first();
      await expect(section).toHaveClass(/level-1/);

      // Now change back to level 2
      await sectionText.press('Tab');

      section = page.locator('.section-header').first();
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
      // Create first section
      await createSection(page, 'Work');

      // Add todos after the section
      await addTodo(page, 'Task 1');
      await addTodo(page, 'Task 2');

      // Create another section
      await createSection(page, 'Personal');

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

  test.describe('Section Group Reordering', () => {
    // Helper: set up two root-level sections with children via events (tree structure)
    async function setupTwoSections(page: any) {
      const now = Date.now();
      await page.evaluate((now: number) => {
        const events = [
          { id: crypto.randomUUID(), itemId: 'sec-a', type: 'item_created', field: null,
            value: { text: 'Section A', position: 'f', type: 'section', level: 1, parentId: null }, timestamp: now, clientId: 'test', seq: 0 },
          { id: crypto.randomUUID(), itemId: 'task-a1', type: 'item_created', field: null,
            value: { text: 'Task A1', position: 'f', parentId: 'sec-a' }, timestamp: now, clientId: 'test', seq: 0 },
          { id: crypto.randomUUID(), itemId: 'task-a2', type: 'item_created', field: null,
            value: { text: 'Task A2', position: 'n', parentId: 'sec-a' }, timestamp: now, clientId: 'test', seq: 0 },
          { id: crypto.randomUUID(), itemId: 'sec-b', type: 'item_created', field: null,
            value: { text: 'Section B', position: 'n', type: 'section', level: 1, parentId: null }, timestamp: now, clientId: 'test', seq: 0 },
          { id: crypto.randomUUID(), itemId: 'task-b1', type: 'item_created', field: null,
            value: { text: 'Task B1', position: 'f', parentId: 'sec-b' }, timestamp: now, clientId: 'test', seq: 0 },
        ];
        localStorage.setItem('decay-events', JSON.stringify(events));
        localStorage.removeItem('decay-todos');
        localStorage.setItem('decay-todos-view-mode', 'active');
      }, now);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('.section-header');
    }

    test('should move section with children using keyboard', async ({ page }) => {
      await setupPage(page);
      await setupTwoSections(page);

      // Verify initial order
      let stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('Section A');
      expect(stored[1].text).toBe('Task A1');
      expect(stored[2].text).toBe('Task A2');
      expect(stored[3].text).toBe('Section B');
      expect(stored[4].text).toBe('Task B1');

      // Move Section B up (should move with its child)
      const sectionBText = page.locator('.section-header .text').last();
      await sectionBText.click();

      // Use explicit key sequence for Meta+Shift+ArrowUp
      await page.keyboard.down(CMD);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.up('Shift');
      await page.keyboard.up(CMD);

      // Wait for reorder to be reflected in DOM
      await expect(page.locator('.section-header .text, .todo-item .text').first()).toHaveText('Section B');

      // Verify localStorage order
      await expect(async () => {
        stored = await getStoredTodos(page);
        expect(stored[0].text).toBe('Section B');
        expect(stored[1].text).toBe('Task B1');
        expect(stored[2].text).toBe('Section A');
        expect(stored[3].text).toBe('Task A1');
        expect(stored[4].text).toBe('Task A2');
      }).toPass({ timeout: 5000 });
    });

    test('should move section down with children using keyboard', async ({ page }) => {
      await setupPage(page);
      await setupTwoSections(page);

      // Verify initial order
      let stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('Section A');
      expect(stored[1].text).toBe('Task A1');
      expect(stored[2].text).toBe('Task A2');
      expect(stored[3].text).toBe('Section B');
      expect(stored[4].text).toBe('Task B1');

      // Move Section A down (should move with its children, below Section B's group)
      const sectionAText = page.locator('.section-header .text').first();
      await sectionAText.click();

      // Use explicit key sequence for Meta+Shift+ArrowDown
      await page.keyboard.down(CMD);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');
      await page.keyboard.up(CMD);

      // Wait for reorder to be reflected in DOM
      await expect(page.locator('.section-header .text, .todo-item .text').first()).toHaveText('Section B');

      // Verify localStorage order
      await expect(async () => {
        stored = await getStoredTodos(page);
        expect(stored[0].text).toBe('Section B');
        expect(stored[1].text).toBe('Task B1');
        expect(stored[2].text).toBe('Section A');
        expect(stored[3].text).toBe('Task A1');
        expect(stored[4].text).toBe('Task A2');
      }).toPass({ timeout: 5000 });
    });

    test('should move section with children using drag-drop', async ({ page }) => {
      await setupPage(page);
      await setupTwoSections(page);

      // Get section A drag handle
      const sectionA = page.locator('.section-header').first();
      const dragHandle = sectionA.locator('.drag-handle');
      const handleBox = await dragHandle.boundingBox();

      // Get Task B1 position (drag section A below it)
      const taskB1 = page.locator('.todo-item').last();
      const taskB1Box = await taskB1.boundingBox();

      if (!handleBox || !taskB1Box) {
        throw new Error('Could not get element positions');
      }

      // Drag Section A to after Task B1
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(taskB1Box.x + taskB1Box.width / 2, taskB1Box.y + taskB1Box.height + 10, { steps: 10 });
      await page.mouse.up();

      // Wait for reorder to be reflected in DOM
      await expect(page.locator('.section-header .text, .todo-item .text').first()).toHaveText('Section B');

      // Verify localStorage order
      await expect(async () => {
        const stored = await getStoredTodos(page);
        expect(stored[0].text).toBe('Section B');
        expect(stored[1].text).toBe('Task B1');
        expect(stored[2].text).toBe('Section A');
        expect(stored[3].text).toBe('Task A1');
        expect(stored[4].text).toBe('Task A2');
      }).toPass({ timeout: 5000 });
    });

    test('should not allow dropping section into middle of another section', async ({ page }) => {
      // Create section A with multiple children
      await createSection(page, 'Section A');
      await addTodo(page, 'Task A1');
      await addTodo(page, 'Task A2');
      await addTodo(page, 'Task A3');

      // Create section B
      await createSection(page, 'Section B');
      await addTodo(page, 'Task B1');

      // Verify initial order
      let stored = await getStoredTodos(page);
      expect(stored[0].text).toBe('Section A');
      expect(stored[1].text).toBe('Task A1');
      expect(stored[2].text).toBe('Task A2');
      expect(stored[3].text).toBe('Task A3');
      expect(stored[4].text).toBe('Section B');
      expect(stored[5].text).toBe('Task B1');

      // Try to drag Section B into the middle of Section A (between Task A1 and Task A2)
      const sectionB = page.locator('.section-header').last();
      const dragHandle = sectionB.locator('.drag-handle');
      const handleBox = await dragHandle.boundingBox();

      // Get Task A2 position (try to drop before it, which would be in middle of Section A)
      const taskA2 = page.locator('.todo-item:has(.text:text-is("Task A2"))');
      const taskA2Box = await taskA2.boundingBox();

      if (!handleBox || !taskA2Box) {
        throw new Error('Could not get element positions');
      }

      // Drag Section B to Task A2's position (middle of Section A)
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(taskA2Box.x + taskA2Box.width / 2, taskA2Box.y + taskA2Box.height / 2, { steps: 10 });
      await page.mouse.up();

      // Wait for any reorder to settle
      await expect(async () => {
        const stored = await getStoredTodos(page);
        expect(stored.length).toBe(6);
      }).toPass({ timeout: 5000 });

      // Section B should NOT be in the middle of Section A
      // It should either stay at original position or move to a valid section boundary
      stored = await getStoredTodos(page);

      // Verify sections are not interleaved - each section's children should be contiguous
      // Section A should have all its tasks together, Section B should have all its tasks together
      const sectionAIndex = stored.findIndex((t: any) => t.text === 'Section A');
      const sectionBIndex = stored.findIndex((t: any) => t.text === 'Section B');

      // All of Section A's tasks should come before Section B (or all after)
      const taskA1Index = stored.findIndex((t: any) => t.text === 'Task A1');
      const taskA2Index = stored.findIndex((t: any) => t.text === 'Task A2');
      const taskA3Index = stored.findIndex((t: any) => t.text === 'Task A3');
      const taskB1Index = stored.findIndex((t: any) => t.text === 'Task B1');

      // Section A's tasks should be contiguous and right after Section A
      expect(taskA1Index).toBe(sectionAIndex + 1);
      expect(taskA2Index).toBe(sectionAIndex + 2);
      expect(taskA3Index).toBe(sectionAIndex + 3);

      // Section B's task should be right after Section B
      expect(taskB1Index).toBe(sectionBIndex + 1);
    });
  });
});
