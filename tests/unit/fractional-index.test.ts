import { describe, test, expect } from 'vitest';
import { generatePositionBetween, generateInitialPositions } from '../../src/lib/fractional-index.js';

describe('generatePositionBetween', () => {
  test('returns "n" for no bounds', () => {
    expect(generatePositionBetween(null, null)).toBe('n');
  });

  test('decrement at b boundary returns "an"', () => {
    expect(generatePositionBetween(null, 'b')).toBe('an');
  });

  test('increment at y boundary returns "z"', () => {
    expect(generatePositionBetween('y', null)).toBe('z');
  });

  test('midpoint with shared prefix', () => {
    expect(generatePositionBetween('na', 'nc')).toBe('nb');
  });

  test('midpoint with adjacent chars and longer before value', () => {
    // Regression test for #40: midpointPosition("sn", "t") was returning "sn" (== before)
    const cases: [string, string][] = [
      ['sn', 't'],
      ['snn', 't'],
      ['smnn', 'sn'],
      ['smnnn', 'sn'],
      ['tn', 'u'],
      ['rg', 'sn'],
      ['rb', 'sc'],
      ['yz', 'z'],
      ['san', 'sb'],
    ];
    for (const [before, after] of cases) {
      const mid = generatePositionBetween(before, after);
      expect(mid > before, `midpoint("${before}", "${after}") = "${mid}" should be > before`).toBe(true);
      expect(mid < after, `midpoint("${before}", "${after}") = "${mid}" should be < after`).toBe(true);
    }
  });

  test('consecutive insertions under a section never produce duplicates', () => {
    let lastPos = 'h';
    const positions = ['h'];
    for (let i = 0; i < 30; i++) {
      const newPos = generatePositionBetween(lastPos, 't');
      expect(newPos > lastPos, `step ${i}: ${newPos} should be > ${lastPos}`).toBe(true);
      expect(newPos < 't', `step ${i}: ${newPos} should be < "t"`).toBe(true);
      positions.push(newPos);
      lastPos = newPos;
    }
    const unique = new Set(positions);
    expect(unique.size).toBe(positions.length);
  });

  test('alternating insertions produce unique sorted positions', () => {
    const positions = ['c', 'x'];
    for (let i = 0; i < 50; i++) {
      const idx = i % (positions.length - 1);
      const mid = generatePositionBetween(positions[idx], positions[idx + 1]);
      expect(mid > positions[idx], `step ${i}: ${mid} should be > ${positions[idx]}`).toBe(true);
      expect(mid < positions[idx + 1], `step ${i}: ${mid} should be < ${positions[idx + 1]}`).toBe(true);
      positions.splice(idx + 1, 0, mid);
    }
    const unique = new Set(positions);
    expect(unique.size).toBe(positions.length);
  });

  test('inserting between each pair and at boundaries produces unique sorted positions', () => {
    const positions = generateInitialPositions(5);
    const allPositions = [...positions];
    for (let i = 0; i < positions.length - 1; i++) {
      allPositions.push(generatePositionBetween(positions[i], positions[i + 1]));
    }
    allPositions.push(generatePositionBetween(null, positions[0]));
    allPositions.push(generatePositionBetween(positions[positions.length - 1], null));

    const unique = new Set(allPositions);
    expect(unique.size).toBe(allPositions.length);

    const sorted = [...allPositions].sort();
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i] < sorted[i + 1]).toBe(true);
    }
  });
});

describe('generateInitialPositions', () => {
  test('returns empty array for 0 items', () => {
    expect(generateInitialPositions(0)).toEqual([]);
  });

  test('returns ["n"] for 1 item', () => {
    expect(generateInitialPositions(1)).toEqual(['n']);
  });

  test.each([5, 10, 22, 23, 30, 50, 100])(
    'with %i items produces unique sorted positions',
    (count) => {
      const positions = generateInitialPositions(count);
      expect(positions.length).toBe(count);

      const unique = new Set(positions);
      expect(unique.size).toBe(count);

      for (let i = 1; i < positions.length; i++) {
        expect(
          positions[i] > positions[i - 1],
          `position[${i}]="${positions[i]}" should be > position[${i - 1}]="${positions[i - 1]}"`
        ).toBe(true);
      }
    }
  );
});
