import { describe, test, expect } from 'vitest';
import {
  getDaysSince,
  getFadeOpacity,
  getImportanceLevel,
  formatDayHeader,
  getDayKey,
  getSiblings,
  getDescendantIds,
  splitOnArrow,
  rebuildParentIds,
  syncHierarchyFromLinearOrder,
  FADE_DURATION_DAYS,
  IMPORTANT_ESCALATION_DAYS,
} from '../../src/utils';
import type { TodoItem } from '../../src/types';

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

describe('getSiblings', () => {
  const makeTodo = (id: string, parentId: string | null = null, position = 'n') => ({
    id, text: id, createdAt: Date.now(), important: false, completed: false,
    archived: false, position, parentId,
  } as any);

  test('returns items with matching parentId sorted by position', () => {
    const todos = [
      makeTodo('c', 'sec', 'z'),
      makeTodo('a', 'sec', 'a'),
      makeTodo('b', 'sec', 'n'),
      makeTodo('other', null, 'n'),
    ];
    const siblings = getSiblings(todos, 'sec');
    expect(siblings.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  test('returns root items when parentId is null', () => {
    const todos = [
      makeTodo('root1', null, 'a'),
      makeTodo('child', 'sec', 'n'),
      makeTodo('root2', null, 'z'),
    ];
    const siblings = getSiblings(todos, null);
    expect(siblings.map(s => s.id)).toEqual(['root1', 'root2']);
  });

  test('returns empty array when no siblings match', () => {
    const todos = [makeTodo('a', 'sec1', 'n')];
    expect(getSiblings(todos, 'sec2')).toEqual([]);
  });

  test('sorts by id as tiebreaker for equal positions', () => {
    const todos = [
      makeTodo('b', null, 'n'),
      makeTodo('a', null, 'n'),
    ];
    const siblings = getSiblings(todos, null);
    expect(siblings.map(s => s.id)).toEqual(['a', 'b']);
  });
});

describe('getDescendantIds', () => {
  const makeTodo = (id: string, parentId: string | null = null) => ({
    id, text: id, createdAt: Date.now(), important: false, completed: false,
    archived: false, position: 'n', parentId,
  } as any);

  const makeSection = (id: string, parentId: string | null = null) => ({
    ...makeTodo(id, parentId), type: 'section' as const,
  });

  test('returns direct children', () => {
    const todos = [
      makeSection('sec'),
      makeTodo('child1', 'sec'),
      makeTodo('child2', 'sec'),
      makeTodo('other', null),
    ];
    expect(getDescendantIds(todos, 'sec')).toEqual(['child1', 'child2']);
  });

  test('returns nested descendants recursively', () => {
    const todos = [
      makeSection('l1'),
      makeSection('l2', 'l1'),
      makeTodo('deep', 'l2'),
      makeTodo('direct', 'l1'),
    ];
    const ids = getDescendantIds(todos, 'l1');
    expect(ids).toContain('l2');
    expect(ids).toContain('deep');
    expect(ids).toContain('direct');
  });

  test('returns empty array for no children', () => {
    const todos = [makeTodo('a', null)];
    expect(getDescendantIds(todos, 'nonexistent')).toEqual([]);
  });
});

describe('rebuildParentIds', () => {
  function makeTodo(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
    return {
      id, text: id, createdAt: Date.now(), important: false, completed: false,
      archived: false, position: 'n', textUpdatedAt: 0, importantUpdatedAt: 0,
      completedUpdatedAt: 0, positionUpdatedAt: 0, typeUpdatedAt: 0,
      levelUpdatedAt: 0, indentedUpdatedAt: 0,
      ...overrides,
    };
  }

  function makeSection(id: string, level: number, overrides: Partial<TodoItem> = {}): TodoItem {
    return makeTodo(id, { type: 'section', level, ...overrides });
  }

  test('items before any section get parentId null', () => {
    const todos = [
      makeTodo('a', { parentId: 'wrong' }),
      makeTodo('b', { parentId: 'wrong' }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'a', field: 'parentId', value: null },
      { itemId: 'b', field: 'parentId', value: null },
    ]);
  });

  test('items after L1 section get parentId = L1', () => {
    const todos = [
      makeSection('sec1', 1),
      makeTodo('a', { parentId: null }),
      makeTodo('b', { parentId: null }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'a', field: 'parentId', value: 'sec1' },
      { itemId: 'b', field: 'parentId', value: 'sec1' },
    ]);
  });

  test('items after L2 under L1 get parentId = L2', () => {
    const todos = [
      makeSection('l1', 1),
      makeSection('l2', 2, { parentId: null }),
      makeTodo('a', { parentId: null }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'l2', field: 'parentId', value: 'l1' },
      { itemId: 'a', field: 'parentId', value: 'l2' },
    ]);
  });

  test('L2 section gets parentId = current L1', () => {
    const todos = [
      makeSection('l1', 1),
      makeSection('l2', 2, { parentId: null }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'l2', field: 'parentId', value: 'l1' },
    ]);
  });

  test('new L1 resets L2 tracking', () => {
    const todos = [
      makeSection('l1a', 1),
      makeSection('l2', 2, { parentId: 'l1a' }),
      makeTodo('a', { parentId: 'l2' }),
      makeSection('l1b', 1),
      makeTodo('b', { parentId: 'l2' }), // wrong: should be l1b
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'b', field: 'parentId', value: 'l1b' },
    ]);
  });

  test('already-correct tree returns no changes', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null }),
      makeSection('l2', 2, { parentId: 'l1' }),
      makeTodo('a', { parentId: 'l2' }),
      makeTodo('b', { parentId: 'l2' }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([]);
  });

  test('archived items are skipped', () => {
    const todos = [
      makeSection('l1', 1),
      makeTodo('archived-item', { parentId: 'wrong', archived: true }),
      makeTodo('active-item', { parentId: null }),
    ];
    const changes = rebuildParentIds(todos);
    // archived-item is skipped, only active-item is fixed
    expect(changes).toEqual([
      { itemId: 'active-item', field: 'parentId', value: 'l1' },
    ]);
  });

  test('mix of correct and incorrect returns only diffs', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null }),
      makeTodo('correct', { parentId: 'l1' }),
      makeTodo('wrong', { parentId: null }),
      makeTodo('also-correct', { parentId: 'l1' }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'wrong', field: 'parentId', value: 'l1' },
    ]);
  });

  test('L1 section has parentId null', () => {
    const todos = [
      makeSection('l1', 1, { parentId: 'something-wrong' }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'l1', field: 'parentId', value: null },
    ]);
  });

  test('L2 without preceding L1 gets parentId null', () => {
    const todos = [
      makeSection('l2', 2, { parentId: 'nonexistent' }),
      makeTodo('a', { parentId: 'nonexistent' }),
    ];
    const changes = rebuildParentIds(todos);
    expect(changes).toEqual([
      { itemId: 'l2', field: 'parentId', value: null },
      { itemId: 'a', field: 'parentId', value: 'l2' },
    ]);
  });

  test('empty list returns no changes', () => {
    expect(rebuildParentIds([])).toEqual([]);
  });
});

describe('syncHierarchyFromLinearOrder', () => {
  function makeTodo(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
    return {
      id, text: id, createdAt: Date.now(), important: false, completed: false,
      archived: false, position: 'n', textUpdatedAt: 0, importantUpdatedAt: 0,
      completedUpdatedAt: 0, positionUpdatedAt: 0, typeUpdatedAt: 0,
      levelUpdatedAt: 0, indentedUpdatedAt: 0,
      ...overrides,
    };
  }

  function makeSection(id: string, level: number, overrides: Partial<TodoItem> = {}): TodoItem {
    return makeTodo(id, { type: 'section', level, ...overrides });
  }

  test('consistent array returns no changes', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null, position: 'f' }),
      makeTodo('a', { parentId: 'l1', position: 'n' }),
      makeTodo('b', { parentId: 'l1', position: 'v' }),
    ];
    const changes = syncHierarchyFromLinearOrder(todos);
    expect(changes).toEqual([]);
  });

  test('parentId diffs only (positions already correct)', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null, position: 'f' }),
      makeTodo('a', { parentId: null, position: 'n' }),
      makeTodo('b', { parentId: null, position: 'v' }),
    ];
    const changes = syncHierarchyFromLinearOrder(todos);
    // Should fix parentIds but not positions (a < b within the l1 group)
    const parentChanges = changes.filter(c => c.field === 'parentId');
    const posChanges = changes.filter(c => c.field === 'position');
    expect(parentChanges).toEqual([
      { itemId: 'a', field: 'parentId', value: 'l1' },
      { itemId: 'b', field: 'parentId', value: 'l1' },
    ]);
    expect(posChanges).toEqual([]);
  });

  test('position diffs (parentIds correct but positions out of order)', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null, position: 'f' }),
      makeTodo('a', { parentId: 'l1', position: 'z' }),
      makeTodo('b', { parentId: 'l1', position: 'a' }),
    ];
    const changes = syncHierarchyFromLinearOrder(todos);
    // parentIds are correct, but positions are out of order (z then a)
    const parentChanges = changes.filter(c => c.field === 'parentId');
    const posChanges = changes.filter(c => c.field === 'position');
    expect(parentChanges).toEqual([]);
    expect(posChanges.length).toBeGreaterThan(0);
    // New positions should be monotonically increasing
    const newPosA = posChanges.find(c => c.itemId === 'a')?.value as string ?? 'z';
    const newPosB = posChanges.find(c => c.itemId === 'b')?.value as string ?? 'a';
    expect(newPosA < newPosB).toBe(true);
  });

  test('combined parentId + position fixes', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null, position: 'f' }),
      makeTodo('a', { parentId: null, position: 'z' }),
      makeTodo('b', { parentId: null, position: 'a' }),
    ];
    const changes = syncHierarchyFromLinearOrder(todos);
    const parentChanges = changes.filter(c => c.field === 'parentId');
    const posChanges = changes.filter(c => c.field === 'position');
    // parentIds should be fixed
    expect(parentChanges).toContainEqual({ itemId: 'a', field: 'parentId', value: 'l1' });
    expect(parentChanges).toContainEqual({ itemId: 'b', field: 'parentId', value: 'l1' });
    // After correcting parentIds, a(z) and b(a) are in l1 group in linear order: a, b
    // Positions z, a are NOT monotonically increasing, so positions should be fixed too
    expect(posChanges.length).toBeGreaterThan(0);
  });

  test('archived items are skipped', () => {
    const todos = [
      makeSection('l1', 1, { parentId: null, position: 'f' }),
      makeTodo('archived-item', { parentId: 'wrong', archived: true, position: 'n' }),
      makeTodo('active-item', { parentId: null, position: 'v' }),
    ];
    const changes = syncHierarchyFromLinearOrder(todos);
    // archived-item should not appear in any changes
    expect(changes.filter(c => c.itemId === 'archived-item')).toEqual([]);
    // active-item should get parentId fixed
    expect(changes).toContainEqual({ itemId: 'active-item', field: 'parentId', value: 'l1' });
  });

  test('empty list returns no changes', () => {
    expect(syncHierarchyFromLinearOrder([])).toEqual([]);
  });

  test('single item returns no changes if already correct', () => {
    const todos = [makeTodo('a', { parentId: null, position: 'n' })];
    expect(syncHierarchyFromLinearOrder(todos)).toEqual([]);
  });
});
