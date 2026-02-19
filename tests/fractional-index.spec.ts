import { test, expect } from '@playwright/test';
import { setupPage } from './helpers';

test.describe('Fractional Indexing - Shared Module', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('shared module is loaded and accessible', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      return {
        exists: !!fi,
        hasGeneratePositionBetween: typeof fi?.generatePositionBetween === 'function',
        hasGenerateInitialPositions: typeof fi?.generateInitialPositions === 'function',
      };
    });

    expect(result.exists).toBe(true);
    expect(result.hasGeneratePositionBetween).toBe(true);
    expect(result.hasGenerateInitialPositions).toBe(true);
  });

  test('app.js uses shared module, not fallback', async ({ page }) => {
    // Temporarily unset ToDoSync and call the app.js generatePositionBetween
    // If app.js still uses the shared module (not the old fallback), it should
    // return 'an' for generatePositionBetween(null, 'b') - the sync.js/shared
    // behavior. The old app.js fallback would return '0n'.
    const result = await page.evaluate(() => {
      // Save and remove ToDoSync to ensure app.js doesn't delegate through it
      const savedSync = (window as any).ToDoSync;
      (window as any).ToDoSync = undefined;

      // Call app.js's generatePositionBetween (it's a global function)
      const pos = (window as any).generatePositionBetween(null, 'b');

      // Restore ToDoSync
      (window as any).ToDoSync = savedSync;

      return pos;
    });

    // The shared module (from sync.js logic) returns 'an' for decrement of 'b'
    // The old app.js fallback would return '0n'
    expect(result).toBe('an');
  });

  // Pure math tests for generatePositionBetween and generateInitialPositions
  // are in tests/unit/fractional-index.test.ts (vitest)
});
