import { test, expect, CDPSession } from '@playwright/test';
import { setupPage, addTodo, getTodoTexts, createSection } from './helpers';

// All tests in this file use touch emulation
test.use({ hasTouch: true });

/** Helper: perform a swipe left gesture via CDP using a single session */
async function swipeLeft(page: import('@playwright/test').Page, element: import('@playwright/test').Locator, distance = 120) {
  const box = await element.boundingBox();
  if (!box) throw new Error('Could not get element bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY }],
    });

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX - (distance * i / steps), y: startY }],
      });
      await page.waitForTimeout(16);
    }

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }

  // Allow snap animation
  await page.waitForTimeout(300);
}

/** Helper: perform a long press via CDP */
async function longPress(page: import('@playwright/test').Page, x: number, y: number, holdMs = 500): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(holdMs);
  return client; // caller must detach
}

test.describe('Touch Gestures', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Swipe to Reveal', () => {
    test('swipe left reveals action tray', async ({ page }) => {
      await addTodo(page, 'Swipeable item');

      const todoContent = page.locator('.todo-item-content').first();

      // Before swipe, content should be at origin
      const beforeTransform = await todoContent.evaluate(el => el.style.transform);
      expect(beforeTransform).toBe('');

      // Swipe left
      await swipeLeft(page, todoContent);

      // After swipe, content should be translated left
      const afterTransform = await todoContent.evaluate(el => el.style.transform);
      expect(afterTransform).toContain('translateX');
      expect(afterTransform).toContain('-');
    });

    test('swipe action buttons perform actions (delete)', async ({ page }) => {
      await addTodo(page, 'Delete me');

      const todoContent = page.locator('.todo-item-content').first();
      await swipeLeft(page, todoContent);

      // Click the delete button in swipe tray
      const deleteBtn = page.locator('.swipe-btn-delete').first();
      await deleteBtn.click();

      // Item should be removed
      await expect(page.locator('.todo-item')).toHaveCount(0);
    });

    test('swipe action buttons perform actions (toggle important)', async ({ page }) => {
      await addTodo(page, 'Important me');

      const todoContent = page.locator('.todo-item-content').first();
      await swipeLeft(page, todoContent);

      // Click the important button in swipe tray
      const importantBtn = page.locator('.swipe-btn-important').first();
      await importantBtn.click();

      // Item should now have important class
      await expect(page.locator('.todo-item').first()).toHaveClass(/important/);
    });

    test('only one tray open at a time', async ({ page }) => {
      await addTodo(page, 'First item');
      await addTodo(page, 'Second item');

      const firstContent = page.locator('.todo-item-content').first();
      const secondContent = page.locator('.todo-item-content').nth(1);

      // Swipe first item
      await swipeLeft(page, firstContent);

      // First should be swiped
      const firstTransform = await firstContent.evaluate(el => el.style.transform);
      expect(firstTransform).toContain('translateX');

      // Swipe second item
      await swipeLeft(page, secondContent);

      // First should be back to origin (closed)
      await expect(firstContent).toHaveJSProperty('style.transform', '');

      // Second should be swiped
      const secondTransform = await secondContent.evaluate(el => el.style.transform);
      expect(secondTransform).toContain('translateX');
    });

    test('vertical scroll does not trigger swipe', async ({ page }) => {
      await addTodo(page, 'Scroll test');

      const todoContent = page.locator('.todo-item-content').first();
      const box = await todoContent.boundingBox();
      if (!box) throw new Error('Could not get bounding box');

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      const client = await page.context().newCDPSession(page);
      try {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: startX, y: startY }],
        });
        // Move mostly vertically
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX + 2, y: startY + 50 }],
        });
        await page.waitForTimeout(16);
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX + 3, y: startY + 100 }],
        });
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } finally {
        await client.detach();
      }

      await page.waitForTimeout(200);

      // Content should not be translated
      const transform = await todoContent.evaluate(el => el.style.transform);
      expect(transform).toBe('');
    });

    test('section items support swipe for delete', async ({ page }) => {
      await createSection(page, 'My Section');

      const sectionContent = page.locator('.section-content').first();
      await swipeLeft(page, sectionContent);

      // Delete button should be visible in tray
      const deleteBtn = page.locator('.section-header .swipe-btn-delete').first();
      await deleteBtn.click();

      // Section should be removed
      await expect(page.locator('.section-header')).toHaveCount(0);
    });
  });

  test.describe('Touch device UI', () => {
    test('action buttons are hidden on touch devices', async ({ page }) => {
      await addTodo(page, 'Hidden actions');

      const actionsDisplay = await page.locator('.todo-item .actions').first().evaluate(el => {
        return getComputedStyle(el).display;
      });
      expect(actionsDisplay).toBe('none');
    });

    test('drag handles are hidden on touch devices', async ({ page }) => {
      await addTodo(page, 'No drag handle');

      const handleDisplay = await page.locator('.drag-handle').first().evaluate(el => {
        return getComputedStyle(el).display;
      });
      expect(handleDisplay).toBe('none');
    });

    test('swipe tray is visible on touch devices', async ({ page }) => {
      await addTodo(page, 'Tray visible');

      const trayDisplay = await page.locator('.swipe-actions-tray').first().evaluate(el => {
        return getComputedStyle(el).display;
      });
      expect(trayDisplay).toBe('flex');
    });
  });

  test.describe('Long Press to Drag', () => {
    test('long press initiates drag and reorders', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Get position of first item (on the checkbox area, not text)
      const firstItem = page.locator('.todo-item').first();
      const firstBox = await firstItem.boundingBox();
      const thirdItem = page.locator('.todo-item').nth(2);
      const thirdBox = await thirdItem.boundingBox();

      if (!firstBox || !thirdBox) throw new Error('Could not get bounding boxes');

      // Touch start on the checkbox area of the first item
      const startX = firstBox.x + 10;
      const startY = firstBox.y + firstBox.height / 2;

      const client = await longPress(page, startX, startY);
      try {
        // Drag clone should appear
        const clone = page.locator('.drag-clone');
        await expect(clone).toBeVisible();

        // Move to after third item
        const endY = thirdBox.y + thirdBox.height + 5;
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX, y: endY }],
        });
        await page.waitForTimeout(50);

        await client.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } finally {
        await client.detach();
      }

      await page.waitForTimeout(100);

      // Verify reorder
      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'Third', 'First']);
    });

    test('long press cancels if finger moves', async ({ page }) => {
      await addTodo(page, 'Moveable');

      const item = page.locator('.todo-item').first();
      const box = await item.boundingBox();
      if (!box) throw new Error('Could not get bounding box');

      const startX = box.x + 10;
      const startY = box.y + box.height / 2;

      const client = await page.context().newCDPSession(page);
      try {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: startX, y: startY }],
        });

        // Move finger significantly before timer fires
        await page.waitForTimeout(100);
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX, y: startY + 50 }],
        });

        await page.waitForTimeout(400);

        // No drag clone should appear
        const clone = page.locator('.drag-clone');
        await expect(clone).toHaveCount(0);

        await client.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } finally {
        await client.detach();
      }
    });

    test('text field tap does not trigger drag', async ({ page }) => {
      await addTodo(page, 'Tappable text');

      // Tap on the text element - should not start drag
      const textEl = page.locator('.todo-item .text').first();
      await textEl.tap();

      await page.waitForTimeout(500);

      // No drag clone should appear
      const clone = page.locator('.drag-clone');
      await expect(clone).toHaveCount(0);
    });
  });
});
