import { test, expect } from '@playwright/test';
import {
  setupPage,
  addTodo,
  getStoredTodos,
} from './helpers';

test.describe('Hyperlink Support', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Cmd+K Link Creation', () => {
    test('should create link from selected text via Cmd+K', async ({ page }) => {
      await addTodo(page, 'Check out this website');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Select "website"
      await textEl.press('End');
      for (let i = 0; i < 7; i++) {
        await textEl.press('Shift+ArrowLeft');
      }

      // Open link editor
      await page.keyboard.press('Meta+k');

      // Wait for link editor dialog
      await page.waitForSelector('.link-editor');

      // Type URL and submit
      const urlInput = page.locator('.link-editor input');
      await urlInput.fill('https://example.com');
      await urlInput.press('Enter');

      // Verify stored text has link
      await page.waitForTimeout(400); // debounce
      const stored = await getStoredTodos(page);
      expect(stored[0].text).toContain('<a href="https://example.com"');
      expect(stored[0].text).toContain('website</a>');
    });

    test('should edit existing link via Cmd+K', async ({ page }) => {
      // Create item with a link already in it
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        const now = Date.now();
        window.EventLog.emitItemCreated(id, {
          text: 'Visit <a href="https://old.com" target="_blank" rel="noopener">here</a>',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item');
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Place cursor inside the link text
      await textEl.press('End');
      await textEl.press('ArrowLeft');

      // Open link editor
      await page.keyboard.press('Meta+k');
      await page.waitForSelector('.link-editor');

      // Should show existing URL
      const urlInput = page.locator('.link-editor input');
      const value = await urlInput.inputValue();
      expect(value).toContain('old.com');

      // Should show Remove button
      await expect(page.locator('.link-editor .remove-link')).toBeVisible();
    });

    test('should remove link via Cmd+K Remove button', async ({ page }) => {
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.EventLog.emitItemCreated(id, {
          text: 'Visit <a href="https://example.com" target="_blank" rel="noopener">here</a> now',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item');
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');
      // Move cursor into "here" (the link text)
      await textEl.press('ArrowLeft');
      await textEl.press('ArrowLeft');
      await textEl.press('ArrowLeft');
      await textEl.press('ArrowLeft');

      await page.keyboard.press('Meta+k');
      await page.waitForSelector('.link-editor');

      // Click Remove
      await page.locator('.link-editor .remove-link').click();

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      expect(stored[0].text).not.toContain('<a');
      expect(stored[0].text).toContain('here');
    });

    test('should close link editor on Escape', async ({ page }) => {
      await addTodo(page, 'Some text');
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Select text
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+k');
      await page.waitForSelector('.link-editor');

      // Press Escape
      await page.locator('.link-editor input').press('Escape');
      await expect(page.locator('.link-editor')).not.toBeVisible();
    });
  });

  test.describe('Paste URL Linkification', () => {
    test('should linkify when pasting URL over selected text', async ({ page }) => {
      await addTodo(page, 'Click here for info');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Select "here"
      // Position: "Click |here| for info" — need to select chars 6-9
      await textEl.press('Home');
      for (let i = 0; i < 6; i++) {
        await textEl.press('ArrowRight');
      }
      for (let i = 0; i < 4; i++) {
        await textEl.press('Shift+ArrowRight');
      }

      // Paste a URL
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData!.setData('text/plain', 'https://example.com');
        el.dispatchEvent(pasteEvent);
      });

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      expect(stored[0].text).toContain('<a href="https://example.com"');
      expect(stored[0].text).toContain('here</a>');
    });

    test('should auto-linkify when pasting bare URL', async ({ page }) => {
      await addTodo(page, 'Check ');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');

      // Paste a bare URL (no selection)
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData!.setData('text/plain', 'https://example.com');
        el.dispatchEvent(pasteEvent);
      });

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      expect(stored[0].text).toContain('<a href="https://example.com"');
      expect(stored[0].text).toContain('>https://example.com</a>');
    });

    test('should not linkify non-URL paste', async ({ page }) => {
      await addTodo(page, 'Hello');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');

      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData!.setData('text/plain', ' world');
        el.dispatchEvent(pasteEvent);
      });

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      expect(stored[0].text).not.toContain('<a');
      expect(stored[0].text).toContain('Hello world');
    });
  });

  test.describe('Enter/Backspace with Links', () => {
    test('should split item with link preserving HTML', async ({ page }) => {
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.EventLog.emitItemCreated(id, {
          text: 'before <a href="https://example.com" target="_blank" rel="noopener">link</a> after',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item');
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();

      // Move cursor to just before "after" (after the link + space)
      // Text content: "before link after" — position cursor at offset 12 (after "before link ")
      await textEl.press('Home');
      for (let i = 0; i < 12; i++) {
        await textEl.press('ArrowRight');
      }

      await textEl.press('Enter');

      await page.waitForFunction(() => document.querySelectorAll('.todo-item').length >= 2);

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      // First item should contain the link
      expect(stored[0].text).toContain('<a href="https://example.com"');
    });

    test('should merge items preserving links from both', async ({ page }) => {
      await page.evaluate(() => {
        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();
        window.EventLog.emitItemCreated(id1, {
          text: 'first <a href="https://a.com" target="_blank" rel="noopener">link</a>',
          position: 'a',
        });
        window.EventLog.emitItemCreated(id2, {
          text: 'second',
          position: 'b',
        });
        window.render();
      });

      await page.waitForFunction(() => document.querySelectorAll('.todo-item').length >= 2);

      // Focus the second item and place cursor at the very beginning
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.focus();

      // Use evaluate to ensure cursor is at position 0
      await page.evaluate(() => {
        const el = document.querySelectorAll('.todo-item .text')[1] as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true); // collapse to start
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await secondText.press('Backspace');

      await page.waitForFunction(() => document.querySelectorAll('.todo-item').length === 1);

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toContain('<a href="https://a.com"');
      expect(stored[0].text).toContain('second');
    });
  });

  test.describe('HTML Sanitization', () => {
    test('should strip disallowed HTML tags on paste', async ({ page }) => {
      await addTodo(page, 'Test');

      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');

      // Paste HTML with disallowed tags
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        });
        pasteEvent.clipboardData!.setData('text/plain', ' <b>bold</b> <script>alert(1)</script>');
        el.dispatchEvent(pasteEvent);
      });

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      // Should have the text but no HTML tags (plain text paste strips everything)
      expect(stored[0].text).not.toContain('<b>');
      expect(stored[0].text).not.toContain('<script>');
    });

    test('should sanitize HTML in stored text', async ({ page }) => {
      // Directly store an item with dangerous HTML
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.EventLog.emitItemCreated(id, {
          text: 'safe <script>alert(1)</script> text',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item');

      // Edit and blur to trigger sanitization
      const textEl = page.locator('.todo-item .text').first();
      await textEl.click();
      await textEl.press('End');
      await textEl.pressSequentially(' ');
      await page.locator('body').click({ position: { x: 10, y: 10 } });

      await page.waitForTimeout(400);
      const stored = await getStoredTodos(page);
      expect(stored[0].text).not.toContain('<script>');
    });
  });

  test.describe('Link Rendering', () => {
    test('should render stored links as clickable anchors', async ({ page }) => {
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.EventLog.emitItemCreated(id, {
          text: 'Visit <a href="https://example.com" target="_blank" rel="noopener">example</a>',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item');

      const anchor = page.locator('.todo-item .text a');
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveAttribute('href', 'https://example.com');
      await expect(anchor).toHaveText('example');
    });

    test('should display plain text items unchanged', async ({ page }) => {
      await addTodo(page, 'Just plain text');

      const textEl = page.locator('.todo-item .text').first();
      const textContent = await textEl.textContent();
      expect(textContent).toBe('Just plain text');

      // No anchor tags
      const anchorCount = await textEl.locator('a').count();
      expect(anchorCount).toBe(0);
    });
  });

  test.describe('Link Click', () => {
    test('should open link on click', async ({ page }) => {
      await page.evaluate(() => {
        const id = crypto.randomUUID();
        window.EventLog.emitItemCreated(id, {
          text: 'Visit <a href="https://example.com" target="_blank" rel="noopener">here</a>',
          position: 'n',
        });
        window.render();
      });

      await page.waitForSelector('.todo-item .text a');

      // Listen for popup (window.open)
      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        page.locator('.todo-item .text a').click(),
      ]);

      expect(popup.url()).toContain('example.com');
    });
  });
});
