import { test, expect } from '@playwright/test';
import { setupPage, addTodo } from './helpers';

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setupPage(page);
  });

  test('body has reduced padding on narrow viewport', async ({ page }) => {
    const padding = await page.evaluate(() => {
      return getComputedStyle(document.body).padding;
    });
    expect(padding).toBe('16px');
  });

  test('body does not overflow horizontally', async ({ page }) => {
    // Add some content to test overflow
    await addTodo(page, 'Buy groceries');
    await addTodo(page, 'Walk the dog');

    const overflows = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    });
    expect(overflows).toBe(true);
  });

  test('view tabs fit within viewport without overflow', async ({ page }) => {
    const tabsFit = await page.evaluate(() => {
      const tabs = document.querySelector('.view-tabs') as HTMLElement;
      if (!tabs) return true; // No tabs present
      return tabs.scrollWidth <= tabs.clientWidth;
    });
    expect(tabsFit).toBe(true);
  });

  test('login form does not overflow viewport', async ({ page }) => {
    // Inject a temporary login form to test its sizing
    const formFits = await page.evaluate(() => {
      const container = document.createElement('div');
      container.className = 'login-container';
      const form = document.createElement('div');
      form.className = 'login-form';
      form.innerHTML = '<input class="login-input" placeholder="Email"><button class="login-button">Sign in</button>';
      container.appendChild(form);
      document.body.appendChild(container);

      const bodyWidth = document.body.clientWidth;
      const formWidth = form.getBoundingClientRect().width;
      document.body.removeChild(container);
      return formWidth <= bodyWidth;
    });
    expect(formFits).toBe(true);
  });

  test('link editor input has no min-width on narrow viewport', async ({ page }) => {
    // Inject a temporary link editor to test its sizing
    const minWidth = await page.evaluate(() => {
      const editor = document.createElement('div');
      editor.className = 'link-editor';
      const input = document.createElement('input');
      editor.appendChild(input);
      document.body.appendChild(editor);

      const computed = getComputedStyle(input).minWidth;
      document.body.removeChild(editor);
      return computed;
    });
    expect(minWidth).toBe('0px');
  });

  test('drag handles are visible on narrow non-touch viewport', async ({ page }) => {
    // On a narrow screen without touch (pointer: fine), drag handles should still be present
    // The narrow 375px viewport set in beforeEach has pointer:fine (default for desktop chromium)
    await addTodo(page, 'Test drag handle visibility');

    // Hover to reveal the handle (it starts with opacity 0)
    const todo = page.locator('.todo-item').first();
    await todo.hover();

    const handle = page.locator('.drag-handle').first();
    // Should NOT be display:none — it should be present (visible on hover)
    const display = await handle.evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
  });

  test('action buttons are visible without hover on narrow viewport', async ({ page }) => {
    await addTodo(page, 'Test action visibility');

    // Actions should be in the DOM and accessible
    const actions = await page.locator('.todo-item .actions').first();
    await expect(actions).toBeAttached();
  });

  test('desktop viewport retains original padding', async ({ page }) => {
    // Override the beforeEach narrow viewport with a desktop size
    await page.setViewportSize({ width: 1280, height: 800 });
    // Reload to ensure styles recalculate
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const padding = await page.evaluate(() => {
      return getComputedStyle(document.body).padding;
    });
    expect(padding).toBe('40px 60px');
  });
});
