import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getTodoTexts,
  getSectionTexts,
  getTodoByText,
  getStoredTodos,
  createSection,
  completeTodo,
} from './helpers';

test.describe('Reordering', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Drag and Drop - Basic', () => {
    test('should reorder todos via drag and drop', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Get the first item's drag handle
      const firstTodo = await getTodoByText(page, 'First');
      const dragHandle = firstTodo.locator('.drag-handle');

      // Get positions
      const handleBox = await dragHandle.boundingBox();
      const thirdTodo = await getTodoByText(page, 'Third');
      const thirdBox = await thirdTodo.boundingBox();

      if (!handleBox || !thirdBox) {
        throw new Error('Could not get element positions');
      }

      // Drag first item to after third
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height + 5, { steps: 10 });
      await page.mouse.up();

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'Third', 'First']);
    });

    test('should show drag clone while dragging', async ({ page }) => {
      await addTodo(page, 'Draggable');

      const todo = await getTodoByText(page, 'Draggable');
      const dragHandle = todo.locator('.drag-handle');

      const handleBox = await dragHandle.boundingBox();
      if (!handleBox) throw new Error('Could not get handle position');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 50, handleBox.y + 100);

      // Check that drag clone exists
      const clone = page.locator('.drag-clone, .drag-clone-container');
      await expect(clone).toBeVisible();

      await page.mouse.up();
    });

    test('should show placeholder while dragging', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Get the original todo element (in #todoList, not the clone)
      const firstTodo = page.locator('#todoList .todo-item:has(.text:text("First"))');
      const dragHandle = firstTodo.locator('.drag-handle');

      const handleBox = await dragHandle.boundingBox();
      if (!handleBox) throw new Error('Could not get handle position');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x, handleBox.y + 100);

      // Original should have placeholder class
      await expect(firstTodo).toHaveClass(/placeholder/);

      await page.mouse.up();
    });
  });

  test.describe('Drag and Drop - Sections', () => {
    test('should drag section with its children', async ({ page }) => {
      // Create section A with todos
      await createSection(page, 'Section A');
      await addTodo(page, 'Task A1');
      await addTodo(page, 'Task A2');

      // Create section B with todos
      await createSection(page, 'Section B');
      await addTodo(page, 'Task B1');

      // Drag Section A to after Task B1
      const sectionA = page.locator('.section-header').first();
      const dragHandle = sectionA.locator('.drag-handle');
      const handleBox = await dragHandle.boundingBox();

      const taskB1 = await getTodoByText(page, 'Task B1');
      const taskB1Box = await taskB1.boundingBox();

      if (!handleBox || !taskB1Box) throw new Error('Could not get positions');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(taskB1Box.x + taskB1Box.width / 2, taskB1Box.y + taskB1Box.height + 10, { steps: 10 });
      await page.mouse.up();

      // Wait for reorder
      await page.waitForTimeout(100);

      const stored = await getStoredTodos(page);
      // Section B and Task B1 should now be first
      expect(stored[0].text).toBe('Section B');
      expect(stored[1].text).toBe('Task B1');
      // Then Section A with its children
      expect(stored[2].text).toBe('Section A');
      expect(stored[3].text).toBe('Task A1');
      expect(stored[4].text).toBe('Task A2');
    });
  });

  test.describe('Drag Handle Visibility', () => {
    test('should show drag handles in Active view', async ({ page }) => {
      await addTodo(page, 'Task');

      const todo = await getTodoByText(page, 'Task');
      await todo.hover();

      const dragHandle = todo.locator('.drag-handle');
      await expect(dragHandle).toBeVisible();
    });

    test('should hide drag handles in Done view', async ({ page }) => {
      await addTodo(page, 'Task');
      await completeTodo(page, 'Task');

      // Switch to Done view
      await page.locator('#doneViewBtn').click();

      const dragHandle = page.locator('.todo-item .drag-handle').first();
      await expect(dragHandle).not.toBeVisible();
    });
  });

  test.describe('Insert Position Accuracy', () => {
    test('should insert at correct position when dragging between items', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');
      await addTodo(page, 'Fourth');

      // Drag Fourth to between First and Second
      const fourthTodo = await getTodoByText(page, 'Fourth');
      const dragHandle = fourthTodo.locator('.drag-handle');
      const handleBox = await dragHandle.boundingBox();

      const secondTodo = await getTodoByText(page, 'Second');
      const secondBox = await secondTodo.boundingBox();

      if (!handleBox || !secondBox) throw new Error('Could not get positions');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      // Drop just above Second (between First and Second)
      await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y - 5, { steps: 10 });
      await page.mouse.up();

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Fourth', 'Second', 'Third']);
    });

    test('should insert at top when dragging above first item', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Drag Third to top
      const thirdTodo = await getTodoByText(page, 'Third');
      const dragHandle = thirdTodo.locator('.drag-handle');
      const handleBox = await dragHandle.boundingBox();

      const firstTodo = await getTodoByText(page, 'First');
      const firstBox = await firstTodo.boundingBox();

      if (!handleBox || !firstBox) throw new Error('Could not get positions');

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y - 20, { steps: 10 });
      await page.mouse.up();

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Third', 'First', 'Second']);
    });
  });
});
