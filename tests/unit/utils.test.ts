import { describe, test, expect } from 'vitest';
import {
  getDaysSince,
  getFadeOpacity,
  getImportanceLevel,
  formatDayHeader,
  getDayKey,
  getItemGroup,
  splitOnArrow,
  FADE_DURATION_DAYS,
  IMPORTANT_ESCALATION_DAYS,
} from '../../src/utils';

const DAY_MS = 1000 * 60 * 60 * 24;

describe('getDaysSince', () => {
  test('returns 0 for same timestamp', () => {
    expect(getDaysSince(1000, 1000)).toBe(0);
  });

  test('returns 1 for 24 hours', () => {
    const now = Date.now();
    expect(getDaysSince(now - DAY_MS, now)).toBeCloseTo(1, 5);
  });

  test('returns 7 for 7 days', () => {
    const now = Date.now();
    expect(getDaysSince(now - 7 * DAY_MS, now)).toBeCloseTo(7, 5);
  });

  test('returns 0.5 for 12 hours', () => {
    const now = Date.now();
    expect(getDaysSince(now - DAY_MS / 2, now)).toBeCloseTo(0.5, 5);
  });
});

describe('getFadeOpacity', () => {
  test('returns 1 for brand new item', () => {
    const now = Date.now();
    expect(getFadeOpacity(now, now)).toBe(1);
  });

  test('returns ~0.5 at halfway through fade duration', () => {
    const now = Date.now();
    const halfDuration = (FADE_DURATION_DAYS / 2) * DAY_MS;
    expect(getFadeOpacity(now - halfDuration, now)).toBeCloseTo(0.5, 1);
  });

  test('returns 0 at fade duration', () => {
    const now = Date.now();
    expect(getFadeOpacity(now - FADE_DURATION_DAYS * DAY_MS, now)).toBeCloseTo(0, 5);
  });

  test('does not go below 0 past fade duration', () => {
    const now = Date.now();
    expect(getFadeOpacity(now - 30 * DAY_MS, now)).toBe(0);
  });
});

describe('getImportanceLevel', () => {
  test('returns 1 for day 0', () => {
    const now = Date.now();
    expect(getImportanceLevel(now, now)).toBe(1);
  });

  test('returns 2 around day 4', () => {
    const now = Date.now();
    expect(getImportanceLevel(now - 4 * DAY_MS, now)).toBe(2);
  });

  test('returns 3 around day 7', () => {
    const now = Date.now();
    expect(getImportanceLevel(now - 7 * DAY_MS, now)).toBe(3);
  });

  test('caps at 5', () => {
    const now = Date.now();
    expect(getImportanceLevel(now - 30 * DAY_MS, now)).toBe(5);
  });

  test('returns 5 at exactly 14 days', () => {
    const now = Date.now();
    expect(getImportanceLevel(now - IMPORTANT_ESCALATION_DAYS * DAY_MS, now)).toBe(5);
  });
});

describe('formatDayHeader', () => {
  test('returns "Today" for same day', () => {
    const now = Date.now();
    expect(formatDayHeader(now, now)).toBe('Today');
  });

  test('returns "Yesterday" for previous day', () => {
    const now = Date.now();
    // Use noon to avoid timezone edge cases
    const today = new Date(now);
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today.getTime() - DAY_MS);
    expect(formatDayHeader(yesterday.getTime(), today.getTime())).toBe('Yesterday');
  });

  test('returns date string for older dates', () => {
    const now = new Date(2026, 1, 19, 12, 0, 0).getTime(); // Feb 19, 2026
    const old = new Date(2026, 1, 10, 12, 0, 0).getTime(); // Feb 10, 2026
    const result = formatDayHeader(old, now);
    // Should be something like "Feb 10" (locale-dependent)
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getDayKey', () => {
  test('returns year-month-day format', () => {
    const date = new Date(2026, 1, 19, 15, 30, 0); // Feb 19, 2026 3:30 PM
    expect(getDayKey(date.getTime())).toBe('2026-1-19');
  });

  test('same day different times produce same key', () => {
    const morning = new Date(2026, 5, 15, 8, 0, 0);
    const evening = new Date(2026, 5, 15, 20, 0, 0);
    expect(getDayKey(morning.getTime())).toBe(getDayKey(evening.getTime()));
  });

  test('different days produce different keys', () => {
    const day1 = new Date(2026, 5, 15);
    const day2 = new Date(2026, 5, 16);
    expect(getDayKey(day1.getTime())).not.toBe(getDayKey(day2.getTime()));
  });
});

describe('splitOnArrow', () => {
  test('splits on ->', () => {
    const result = splitOnArrow('A -> B');
    expect(result).toEqual({ before: 'A', after: 'B' });
  });

  test('splits on -->', () => {
    const result = splitOnArrow('First --> Second');
    expect(result).toEqual({ before: 'First', after: 'Second' });
  });

  test('splits on Unicode arrow →', () => {
    const result = splitOnArrow('Start → End');
    expect(result).toEqual({ before: 'Start', after: 'End' });
  });

  test('splits on other Unicode arrows', () => {
    expect(splitOnArrow('A ➔ B')).toEqual({ before: 'A', after: 'B' });
    expect(splitOnArrow('A ➜ B')).toEqual({ before: 'A', after: 'B' });
    expect(splitOnArrow('A ⇒ B')).toEqual({ before: 'A', after: 'B' });
    expect(splitOnArrow('A ⟶ B')).toEqual({ before: 'A', after: 'B' });
  });

  test('splits only on first arrow', () => {
    const result = splitOnArrow('A -> B -> C');
    expect(result).toEqual({ before: 'A', after: 'B -> C' });
  });

  test('trims whitespace', () => {
    const result = splitOnArrow('  A  ->  B  ');
    expect(result).toEqual({ before: 'A', after: 'B' });
  });

  test('returns null for no arrow', () => {
    expect(splitOnArrow('Regular task')).toBeNull();
  });

  test('returns null for single dash', () => {
    expect(splitOnArrow('A - B')).toBeNull();
  });

  test('returns null for greater than alone', () => {
    expect(splitOnArrow('A > B')).toBeNull();
  });

  test('returns null if nothing before arrow', () => {
    expect(splitOnArrow('-> B')).toBeNull();
  });

  test('returns null if nothing after arrow', () => {
    expect(splitOnArrow('A ->')).toBeNull();
  });

  test('returns null for arrow only', () => {
    expect(splitOnArrow('->')).toBeNull();
  });

  test('handles long arrow --->', () => {
    const result = splitOnArrow('A ---> B');
    expect(result).toEqual({ before: 'A', after: 'B' });
  });
});

describe('getItemGroup', () => {
  const makeTodo = (text: string, overrides: any = {}) => ({
    id: text,
    text,
    createdAt: Date.now(),
    important: false,
    completed: false,
    archived: false,
    position: 'n',
    ...overrides,
  });

  const makeSection = (text: string, level: number = 2, overrides: any = {}) => ({
    ...makeTodo(text),
    type: 'section' as const,
    level,
    ...overrides,
  });

  test('non-section returns just itself', () => {
    const todos = [makeTodo('A'), makeTodo('B')];
    expect(getItemGroup(todos, 0)).toEqual([0]);
    expect(getItemGroup(todos, 1)).toEqual([1]);
  });

  test('returns empty for invalid index', () => {
    expect(getItemGroup([], 0)).toEqual([]);
    expect(getItemGroup([makeTodo('A')], 5)).toEqual([]);
  });

  test('level-2 section includes following todos until next section', () => {
    const todos = [
      makeSection('Section A'),
      makeTodo('Item 1'),
      makeTodo('Item 2'),
      makeSection('Section B'),
      makeTodo('Item 3'),
    ];
    expect(getItemGroup(todos, 0)).toEqual([0, 1, 2]);
  });

  test('level-1 section includes following level-2 sections and todos', () => {
    const todos = [
      makeSection('H1', 1),
      makeTodo('Item 1'),
      makeSection('H2', 2),
      makeTodo('Item 2'),
      makeSection('Another H1', 1),
    ];
    expect(getItemGroup(todos, 0)).toEqual([0, 1, 2, 3]);
  });

  test('level-1 section stops at next level-1 section', () => {
    const todos = [
      makeSection('H1-A', 1),
      makeTodo('Item 1'),
      makeSection('H1-B', 1),
      makeTodo('Item 2'),
    ];
    expect(getItemGroup(todos, 0)).toEqual([0, 1]);
  });

  test('section at end of list includes everything after', () => {
    const todos = [
      makeTodo('Before'),
      makeSection('Last Section'),
      makeTodo('Item 1'),
      makeTodo('Item 2'),
    ];
    expect(getItemGroup(todos, 1)).toEqual([1, 2, 3]);
  });

  test('skips archived items in group', () => {
    const todos = [
      makeSection('Section'),
      makeTodo('Active'),
      makeTodo('Archived', { archived: true }),
      makeTodo('Also Active'),
      makeSection('Next'),
    ];
    // archived items are skipped (continue), not included but don't break the loop
    expect(getItemGroup(todos, 0)).toEqual([0, 1, 3]);
  });
});
