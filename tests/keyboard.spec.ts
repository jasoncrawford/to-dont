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

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test.describe('Arrow Key Navigation', () => {
    test('should navigate down with ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Navigate down
      await firstText.press('ArrowDown');

      // Second item should be focused
      const secondText = page.locator('.todo-item .text').nth(1);
      await expect(secondText).toBeFocused();
    });

    test('should navigate up with ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus second item
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();

      // Navigate up
      await secondText.press('ArrowUp');

      // First item should be focused
      const firstText = page.locator('.todo-item .text').first();
      await expect(firstText).toBeFocused();
    });

    test('should stay at first item when pressing ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await firstText.press('ArrowUp');

      // Should still be focused on first
      await expect(firstText).toBeFocused();
    });

    test('should navigate through sections and todos', async ({ page }) => {
      // Create section
      await createSection(page, 'Section');

      await addTodo(page, 'Task under section');

      // Focus section
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();

      // Navigate down to todo
      await sectionText.press('ArrowDown');

      const todoText = page.locator('.todo-item .text').first();
      await expect(todoText).toBeFocused();
    });
  });

  test.describe('Left/Right Arrow Navigation', () => {
    test('should move to next item at start when right arrow at end', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await firstText.press('End');

      await firstText.press('ArrowRight');

      const secondText = page.locator('.todo-item .text').nth(1);
      await expect(secondText).toBeFocused();

      // Cursor should be at start of second item
      const cursorPos = await page.evaluate(() => {
        const sel = window.getSelection();
        return sel?.getRangeAt(0).startOffset;
      });
      expect(cursorPos).toBe(0);
    });

    test('should move to previous item at end when left arrow at start', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await secondText.press('Home');

      await secondText.press('ArrowLeft');

      const firstText = page.locator('.todo-item .text').first();
      await expect(firstText).toBeFocused();

      // Cursor should be at end of first item
      const cursorPos = await page.evaluate(() => {
        const sel = window.getSelection();
        const range = sel?.getRangeAt(0);
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        return range?.startOffset === el.textContent?.length;
      });
      expect(cursorPos).toBe(true);
    });

    test('should not move when right arrow at end of last item', async ({ page }) => {
      await addTodo(page, 'Only');

      const text = page.locator('.todo-item .text').first();
      await text.click();
      await text.press('End');

      await text.press('ArrowRight');

      // Should still be focused on same item
      await expect(text).toBeFocused();
    });

    test('should not move when left arrow at start of first item', async ({ page }) => {
      await addTodo(page, 'Only');

      const text = page.locator('.todo-item .text').first();
      await text.click();
      await text.press('Home');

      await text.press('ArrowLeft');

      // Should still be focused on same item
      await expect(text).toBeFocused();
    });

    test('should navigate between section and todo with right arrow', async ({ page }) => {
      await createSection(page, 'Section');
      await addTodo(page, 'Task');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('End');

      await sectionText.press('ArrowRight');

      const todoText = page.locator('.todo-item .text').first();
      await expect(todoText).toBeFocused();
    });

    test('should navigate between todo and section with left arrow', async ({ page }) => {
      await createSection(page, 'Section');
      await addTodo(page, 'Task');

      const todoText = page.locator('.todo-item .text').first();
      await todoText.click();
      await todoText.press('Home');

      await todoText.press('ArrowLeft');

      const sectionText = page.locator('.section-header .text').first();
      await expect(sectionText).toBeFocused();
    });

    test('should not move when cursor is in middle of text (right arrow)', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Position cursor in middle
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild!, 2);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await firstText.press('ArrowRight');

      // Should still be on first item (cursor moved within text)
      await expect(firstText).toBeFocused();
    });

    test('should not move when cursor is in middle of text (left arrow)', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();

      // Position cursor in middle
      await page.evaluate(() => {
        const el = document.querySelectorAll('.todo-item .text')[1] as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild!, 2);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await secondText.press('ArrowLeft');

      // Should still be on second item (cursor moved within text)
      await expect(secondText).toBeFocused();
    });
  });

  test.describe('Cmd+Arrow Navigation', () => {
    test('should jump to first item with Cmd+ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus last item
      const lastText = page.locator('.todo-item .text').last();
      await lastText.click();

      // Jump to first
      await lastText.press(`${CMD}+ArrowUp`);

      const firstText = page.locator('.todo-item .text').first();
      await expect(firstText).toBeFocused();
    });

    test('should jump to last item with Cmd+ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Jump to last
      await firstText.press(`${CMD}+ArrowDown`);

      const lastText = page.locator('.todo-item .text').last();
      await expect(lastText).toBeFocused();
    });
  });

  test.describe('Enter Key Behavior', () => {
    test('should insert todo below when cursor at end', async ({ page }) => {
      await addTodo(page, 'First');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move cursor to end
      await firstText.press('End');
      await firstText.press('Enter');

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);

      // New item should be second
      const texts = await getTodoTexts(page);
      expect(texts[0]).toBe('First');
      expect(texts[1]).toBe('');
    });

    test('should insert todo at bottom when Enter at end of last item with multiple items', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus last item and move cursor to end
      const lastText = page.locator('.todo-item .text').last();
      await lastText.click();
      await lastText.press('End');

      // Press Enter to create new item
      await lastText.press('Enter');

      // New empty item should be at the bottom (4th position)
      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Second', 'Third', '']);

      // The new empty item should be focused
      const newText = page.locator('.todo-item .text').last();
      await expect(newText).toBeFocused();
    });

    test('should insert todo above when cursor at start, keeping focus on current', async ({ page }) => {
      await addTodo(page, 'First');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move cursor to start
      await firstText.press('Home');
      await firstText.press('Enter');

      const texts = await getTodoTexts(page);
      expect(texts.length).toBe(2);
      expect(texts[0]).toBe('');
      expect(texts[1]).toBe('First');

      // Focus should remain on the original item (now second)
      const secondText = page.locator('.todo-item .text').nth(1);
      await expect(secondText).toBeFocused();
    });

    test('should split todo into two when cursor in middle', async ({ page }) => {
      await addTodo(page, 'HelloWorld');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Position cursor in middle (after "Hello")
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        const textNode = el.firstChild as Text;
        range.setStart(textNode, 5);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await firstText.press('Enter');

      // Should now be two items
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Hello');
      expect(stored[1].text).toBe('World');
    });

    test('should insert empty section above when Enter at start of section', async ({ page }) => {
      await createSection(page, 'MySection');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('Home');
      await sectionText.press('Enter');

      // Should now have two sections
      const sections = await getSectionTexts(page);
      expect(sections.length).toBe(2);
      expect(sections[0]).toBe('');
      expect(sections[1]).toBe('MySection');

      // Focus should remain on the original section (now second)
      const secondSection = page.locator('.section-header .text').nth(1);
      await expect(secondSection).toBeFocused();
    });

    test('should insert indented item above when Enter at start of indented item', async ({ page }) => {
      await createSection(page, 'Sec');
      await addTodo(page, 'Child');

      // Indent the child item
      const childText = page.locator('.todo-item .text').first();
      await childText.click();
      await childText.press('Tab');

      // Verify it's indented
      await expect(page.locator('.todo-item.indented')).toHaveCount(1);

      // Press Enter at start
      await childText.press('Home');
      await childText.press('Enter');

      // Should have 2 items, both indented
      const items = page.locator('.todo-item');
      await expect(items).toHaveCount(2);
      await expect(page.locator('.todo-item.indented')).toHaveCount(2);

      const texts = await getTodoTexts(page);
      expect(texts[0]).toBe('');
      expect(texts[1]).toBe('Child');
    });

    test('should split section into two sections when Enter in middle', async ({ page }) => {
      await createSection(page, 'HelloWorld');

      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();

      // Position cursor after "Hello" (5 chars)
      await page.evaluate(() => {
        const el = document.querySelector('.section-header .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        const textNode = el.firstChild as Text;
        range.setStart(textNode, 5);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await sectionText.press('Enter');

      // Should now have two sections
      const sections = await getSectionTexts(page);
      expect(sections.length).toBe(2);
      // Section text is uppercased in display, so check stored data
      const stored = await getStoredTodos(page);
      const sectionItems = stored.filter((t: any) => t.type === 'section');
      expect(sectionItems.length).toBe(2);
      expect(sectionItems[0].text.toLowerCase()).toBe('hello');
      expect(sectionItems[1].text.toLowerCase()).toBe('world');
    });

    test('should place split section immediately after original, with children under new section', async ({ page }) => {
      await createSection(page, 'HelloWorld');
      await addTodo(page, 'Child');

      // Verify child is under the section
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();

      // Position cursor after "Hello" (5 chars)
      await page.evaluate(() => {
        const el = document.querySelector('.section-header .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        const textNode = el.firstChild as Text;
        range.setStart(textNode, 5);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await sectionText.press('Enter');

      // Visual order should be: Hello section, World section, Child item
      const allTextEls = page.locator('.section-header .text, .todo-item .text');
      await expect(allTextEls).toHaveCount(3);

      const allTexts = await allTextEls.allTextContents();
      // Section text is uppercased in display
      expect(allTexts[0].toLowerCase()).toBe('hello');
      expect(allTexts[1].toLowerCase()).toBe('world');
      expect(allTexts[2]).toBe('Child');

      // Child should be under the new (World) section, not the original (Hello)
      const stored = await getStoredTodos(page);
      const worldSection = stored.find((t: any) => t.type === 'section' && t.text.toLowerCase() === 'world');
      const child = stored.find((t: any) => t.text === 'Child');
      expect(child.parentId).toBe(worldSection.id);
    });
  });

  test.describe('Backspace Key Behavior', () => {
    test('should merge with previous item when backspace at start', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      // Focus second item and position cursor at start
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await page.evaluate(() => {
        const el = document.querySelectorAll('.todo-item .text')[1] as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild || el, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await secondText.press('Backspace');

      // Should now be one item with merged text
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('HelloWorld');
    });

    test('should not merge if cursor is not at start', async ({ page }) => {
      await addTodo(page, 'Hello');
      await addTodo(page, 'World');

      // Focus second item and add text at end, then backspace (ensures cursor not at start)
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await secondText.press('End');
      await page.keyboard.type('X');
      await page.waitForTimeout(50);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(50);

      // Should still be two items (no merge happened)
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(2);
      expect(stored[0].text).toBe('Hello');
      expect(stored[1].text).toBe('World');
    });

    test('should not merge first item with nothing', async ({ page }) => {
      await addTodo(page, 'Only item');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await page.evaluate(() => {
        const el = document.querySelector('.todo-item .text') as HTMLElement;
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(el.firstChild || el, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await firstText.press('Backspace');

      // Should still be one item, unchanged
      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text).toBe('Only item');
    });

    test('should merge item text into section header when backspace at start of item after section', async ({ page }) => {
      await createSection(page, 'Header');
      await addTodo(page, 'Child');

      // Focus the child item and position cursor at start
      const childText = page.locator('.todo-item .text').first();
      await childText.click();
      await childText.press('Home');

      await childText.press('Backspace');

      // Item should be merged into section header
      await expect(page.locator('.todo-item')).toHaveCount(0);
      await expect(page.locator('.section-header')).toHaveCount(1);

      const stored = await getStoredTodos(page);
      const sectionItem = stored.find((t: any) => t.type === 'section');
      expect(sectionItem).toBeDefined();
      expect(sectionItem.text.toLowerCase()).toContain('header');
      expect(sectionItem.text.toLowerCase()).toContain('child');
    });

    test('should convert section to item and merge with previous when backspace at start of section', async ({ page }) => {
      await addTodo(page, 'Above');
      await createSection(page, 'MySection');

      // Focus the section and position cursor at start
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('Home');

      await sectionText.press('Backspace');

      // Section should be converted and merged with item above
      await expect(page.locator('.section-header')).toHaveCount(0);
      await expect(page.locator('.todo-item')).toHaveCount(1);

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].text.toLowerCase()).toContain('above');
      expect(stored[0].text.toLowerCase()).toContain('mysection');
    });

    test('should do nothing when backspace at start of first section with no item above', async ({ page }) => {
      await createSection(page, 'OnlySection');

      // Focus the section and position cursor at start
      const sectionText = page.locator('.section-header .text').first();
      await sectionText.click();
      await sectionText.press('Home');

      await sectionText.press('Backspace');

      // Section should remain unchanged — no-op
      await expect(page.locator('.section-header')).toHaveCount(1);
      await expect(page.locator('.todo-item')).toHaveCount(0);

      const stored = await getStoredTodos(page);
      expect(stored.length).toBe(1);
      expect(stored[0].type).toBe('section');
      expect(stored[0].text.toLowerCase()).toContain('onlysection');
    });
  });

  test.describe('Reordering with Keyboard', () => {
    test('should move item up with Cmd+Shift+ArrowUp', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus second item
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();

      // Move up
      await secondText.press(`${CMD}+Shift+ArrowUp`);

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'First', 'Third']);
    });

    test('should move item down with Cmd+Shift+ArrowDown', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');
      await addTodo(page, 'Third');

      // Focus first item
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      // Move down
      await firstText.press(`${CMD}+Shift+ArrowDown`);

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['Second', 'First', 'Third']);
    });

    test('should not move first item up', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();

      await firstText.press(`${CMD}+Shift+ArrowUp`);

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Second']);
    });

    test('should not move last item down', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      const lastText = page.locator('.todo-item .text').last();
      await lastText.click();

      await lastText.press(`${CMD}+Shift+ArrowDown`);

      const texts = await getTodoTexts(page);
      expect(texts).toEqual(['First', 'Second']);
    });

    test('should preserve unsaved text when moving up', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus second item and type new text without blurring
      const secondText = page.locator('.todo-item .text').nth(1);
      await secondText.click();
      await secondText.press('End');
      await page.keyboard.type(' modified');

      // Move up immediately (before blur saves)
      await page.keyboard.press(`${CMD}+Shift+ArrowUp`);

      // Text should be preserved (use auto-retrying assertions)
      await expect(page.locator('.todo-item .text').first()).toHaveText('Second modified');
      await expect(page.locator('.todo-item .text').nth(1)).toHaveText('First');
    });

    test('should preserve unsaved text when moving down', async ({ page }) => {
      await addTodo(page, 'First');
      await addTodo(page, 'Second');

      // Focus first item and type new text without blurring
      const firstText = page.locator('.todo-item .text').first();
      await firstText.click();
      await firstText.press('End');
      await page.keyboard.type(' modified');

      // Move down immediately (before blur saves)
      await page.keyboard.press(`${CMD}+Shift+ArrowDown`);

      // Text should be preserved (use auto-retrying assertions)
      await expect(page.locator('.todo-item .text').first()).toHaveText('Second');
      await expect(page.locator('.todo-item .text').nth(1)).toHaveText('First modified');
    });
  });

});
