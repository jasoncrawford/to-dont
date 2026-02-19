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

  test('decrement at b boundary returns correct result', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as any).FractionalIndex.generatePositionBetween(null, 'b');
    });

    expect(result).toBe('an');
  });

  test('increment at y boundary returns correct result', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as any).FractionalIndex.generatePositionBetween('y', null);
    });

    expect(result).toBe('z');
  });

  test('midpoint with shared prefix works correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as any).FractionalIndex.generatePositionBetween('na', 'nc');
    });

    expect(result).toBe('nb');
  });

  test('inserting multiple items produces correctly sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;

      // Create 5 initial positions
      const positions = fi.generateInitialPositions(5);

      // Insert items between each pair
      const allPositions = [...positions];
      for (let i = 0; i < positions.length - 1; i++) {
        const between = fi.generatePositionBetween(positions[i], positions[i + 1]);
        allPositions.push(between);
      }

      // Also insert before first and after last
      allPositions.push(fi.generatePositionBetween(null, positions[0]));
      allPositions.push(fi.generatePositionBetween(positions[positions.length - 1], null));

      // Sort and check order is maintained
      const sorted = [...allPositions].sort();

      // Verify all positions are unique
      const unique = new Set(allPositions);

      return {
        allPositions,
        sorted,
        allUnique: unique.size === allPositions.length,
      };
    });

    expect(result.allUnique).toBe(true);
    // Verify all positions sort in strictly increasing order
    for (let i = 0; i < result.sorted.length - 1; i++) {
      expect(result.sorted[i] < result.sorted[i + 1]).toBe(true);
    }
  });


  test('generateInitialPositions with exactly 22 items produces unique sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const positions = fi.generateInitialPositions(22);
      const unique = new Set(positions);
      const sorted = [...positions].sort();
      return {
        count: positions.length,
        allUnique: unique.size === positions.length,
        inOrder: JSON.stringify(positions) === JSON.stringify(sorted),
        positions,
      };
    });

    expect(result.count).toBe(22);
    expect(result.allUnique).toBe(true);
    expect(result.inOrder).toBe(true);
  });

  test('generateInitialPositions with 23 items produces unique sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const positions = fi.generateInitialPositions(23);
      const unique = new Set(positions);
      const sorted = [...positions].sort();
      return {
        count: positions.length,
        allUnique: unique.size === positions.length,
        inOrder: JSON.stringify(positions) === JSON.stringify(sorted),
        positions,
      };
    });

    expect(result.count).toBe(23);
    expect(result.allUnique).toBe(true);
    expect(result.inOrder).toBe(true);
  });

  test('generateInitialPositions with 50 items produces unique sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const positions = fi.generateInitialPositions(50);
      const unique = new Set(positions);
      const sorted = [...positions].sort();
      return {
        count: positions.length,
        allUnique: unique.size === positions.length,
        inOrder: JSON.stringify(positions) === JSON.stringify(sorted),
        positions,
      };
    });

    expect(result.count).toBe(50);
    expect(result.allUnique).toBe(true);
    expect(result.inOrder).toBe(true);
  });

  test('generateInitialPositions with 100 items produces unique sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const positions = fi.generateInitialPositions(100);
      const unique = new Set(positions);
      const sorted = [...positions].sort();
      return {
        count: positions.length,
        allUnique: unique.size === positions.length,
        inOrder: JSON.stringify(positions) === JSON.stringify(sorted),
        positions,
      };
    });

    expect(result.count).toBe(100);
    expect(result.allUnique).toBe(true);
    expect(result.inOrder).toBe(true);
  });

  test('midpoint with adjacent chars and longer before produces valid position', async ({ page }) => {
    // Regression test for #40: midpointPosition("sn", "t") was returning "sn" (== before)
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const cases = [
        ['sn', 't'],      // was returning "sn" (== before)
        ['snn', 't'],     // was returning "sn" (< before)
        ['smnn', 'sn'],   // was returning "smn" (< before)
        ['smnnn', 'sn'],  // was returning "smn" (< before)
        ['tn', 'u'],      // was returning "tn" (== before)
        ['rg', 'sn'],     // was returning "rg" (== before, via after-remaining path)
        ['rb', 'sc'],     // was returning "rb" (== before, via after-remaining path)
        ['yz', 'z'],
        ['san', 'sb'],
      ];
      const results: { before: string; after: string; mid: string; valid: boolean }[] = [];
      for (const [before, after] of cases) {
        const mid = fi.generatePositionBetween(before, after);
        results.push({ before, after, mid, valid: mid > before && mid < after });
      }
      return results;
    });

    for (const r of result) {
      expect(r.valid, `midpoint("${r.before}", "${r.after}") = "${r.mid}" should be between them`).toBe(true);
    }
  });

  test('consecutive insertions under a section never produce duplicate positions', async ({ page }) => {
    // Regression test for #40: after ~6 insertions, positions would duplicate
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      // Simulate: section at "h", next section at "t", repeatedly press Enter
      let lastPos = 'h';
      const positions = ['h'];
      for (let i = 0; i < 30; i++) {
        const newPos = fi.generatePositionBetween(lastPos, 't');
        if (newPos <= lastPos || newPos >= 't') {
          return { ok: false, step: i, lastPos, newPos };
        }
        positions.push(newPos);
        lastPos = newPos;
      }
      const unique = new Set(positions);
      return { ok: true, count: positions.length, allUnique: unique.size === positions.length };
    });

    expect(result.ok).toBe(true);
    if ('allUnique' in result) {
      expect(result.allUnique).toBe(true);
    }
  });

  test('alternating insertions produce unique sorted positions', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      const positions = ['c', 'x'];
      for (let i = 0; i < 50; i++) {
        const idx = i % (positions.length - 1);
        const mid = fi.generatePositionBetween(positions[idx], positions[idx + 1]);
        if (mid <= positions[idx] || mid >= positions[idx + 1]) {
          return { ok: false, step: i, before: positions[idx], after: positions[idx + 1], mid };
        }
        positions.splice(idx + 1, 0, mid);
      }
      const unique = new Set(positions);
      return { ok: true, count: positions.length, allUnique: unique.size === positions.length };
    });

    expect(result.ok).toBe(true);
    if ('allUnique' in result) {
      expect(result.allUnique).toBe(true);
    }
  });

  test('generateInitialPositions positions are lexicographically strictly increasing', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fi = (window as any).FractionalIndex;
      // Test across several sizes including beyond single-char limit
      const sizes = [5, 10, 22, 23, 30, 50, 100];
      const results: { size: number; strictlyIncreasing: boolean }[] = [];

      for (const size of sizes) {
        const positions = fi.generateInitialPositions(size);
        let strictlyIncreasing = true;
        for (let i = 1; i < positions.length; i++) {
          if (positions[i] <= positions[i - 1]) {
            strictlyIncreasing = false;
            break;
          }
        }
        results.push({ size, strictlyIncreasing });
      }
      return results;
    });

    for (const r of result) {
      expect(r.strictlyIncreasing).toBe(true);
    }
  });
});
