import { describe, test, expect } from 'vitest';
import { buildConvertToSectionEvents, BatchEvent } from '../../src/utils';
import type { TodoItem } from '../../src/types';

// Helper to build a minimal TodoItem for testing
function makeTodo(
  id: string,
  overrides: Partial<TodoItem> = {},
): TodoItem {
  return {
    id,
    text: overrides.text ?? id,
    createdAt: Date.now(),
    important: false,
    completed: false,
    archived: false,
    position: overrides.position ?? 'n',
    textUpdatedAt: 0,
    importantUpdatedAt: 0,
    completedUpdatedAt: 0,
    positionUpdatedAt: 0,
    typeUpdatedAt: 0,
    levelUpdatedAt: 0,
    indentedUpdatedAt: 0,
    ...overrides,
  };
}

function makeSection(
  id: string,
  overrides: Partial<TodoItem> = {},
): TodoItem {
  return makeTodo(id, { type: 'section', level: 1, ...overrides });
}

// Helpers to query the generated events
function eventsFor(batch: BatchEvent[], itemId: string) {
  return batch.filter(e => e.itemId === itemId);
}

function fieldValue(batch: BatchEvent[], itemId: string, field: string) {
  const event = batch.find(e => e.itemId === itemId && e.field === field);
  return event?.value;
}

describe('buildConvertToSectionEvents', () => {
  // Note: adoption of following siblings is now handled by rebuildParentIds()
  // after the batch is emitted. This function only handles base conversion
  // (type, level, text) and promotion (moving out of parent section).

  describe('basic conversion', () => {
    test('returns null for nonexistent item', () => {
      expect(buildConvertToSectionEvents([], 'missing')).toBeNull();
    });

    test('sets type to section, level to 2, and clears text', () => {
      const todos = [makeTodo('a')];
      const batch = buildConvertToSectionEvents(todos, 'a')!;

      expect(fieldValue(batch, 'a', 'type')).toBe('section');
      expect(fieldValue(batch, 'a', 'level')).toBe(2);
      expect(fieldValue(batch, 'a', 'text')).toBe('');
    });

    test('single item with no siblings produces exactly 3 events', () => {
      const todos = [makeTodo('a')];
      const batch = buildConvertToSectionEvents(todos, 'a')!;

      expect(batch).toHaveLength(3);
    });

    test('root item with followers produces only 3 base events (no adoption)', () => {
      const todos = [
        makeTodo('a', { position: 'a' }),
        makeTodo('b', { position: 'b' }),
        makeTodo('c', { position: 'c' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'a')!;

      // Only base events: type, level, text
      expect(batch).toHaveLength(3);
      // No events for followers
      expect(eventsFor(batch, 'b')).toHaveLength(0);
      expect(eventsFor(batch, 'c')).toHaveLength(0);
    });

    test('does not emit events for preceding items', () => {
      const todos = [
        makeTodo('a', { position: 'a' }),
        makeTodo('b', { position: 'b' }),
        makeTodo('c', { position: 'c' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'b')!;

      expect(eventsFor(batch, 'a')).toHaveLength(0);
    });
  });

  describe('promotion out of parent section', () => {
    test('promotes item out of parent to root with level 1', () => {
      const todos = [
        makeSection('parent', { position: 'a', parentId: null }),
        makeTodo('child', { position: 'a', parentId: 'parent' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child')!;

      expect(fieldValue(batch, 'child', 'parentId')).toBeNull();
      expect(fieldValue(batch, 'child', 'level')).toBe(1);
    });

    test('promoted item is positioned after its old parent', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null }),
        makeTodo('child', { position: 'a', parentId: 'sec-a' }),
        makeSection('sec-b', { position: 'z', parentId: null }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child')!;

      const newPos = fieldValue(batch, 'child', 'position') as string;
      expect(newPos > 'a').toBe(true);
      expect(newPos < 'z').toBe(true);
    });

    test('promoted item positioned after parent when parent is last root sibling', () => {
      const todos = [
        makeSection('parent', { position: 'n', parentId: null }),
        makeTodo('child', { position: 'a', parentId: 'parent' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child')!;

      const newPos = fieldValue(batch, 'child', 'position') as string;
      expect(newPos > 'n').toBe(true);
    });

    test('does not promote when item has no parent (root level)', () => {
      const todos = [
        makeTodo('a', { position: 'a', parentId: null }),
        makeTodo('b', { position: 'b', parentId: null }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'a')!;

      const aEvents = eventsFor(batch, 'a');
      expect(aEvents.find(e => e.field === 'parentId')).toBeUndefined();
      expect(aEvents.find(e => e.field === 'position')).toBeUndefined();
    });

    test('promotes to grandparent when parent is nested, keeps level 2', () => {
      const todos = [
        makeSection('grandparent', { position: 'a', parentId: null }),
        makeSection('parent', { position: 'a', parentId: 'grandparent' }),
        makeTodo('child', { position: 'a', parentId: 'parent' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child')!;

      expect(fieldValue(batch, 'child', 'parentId')).toBe('grandparent');
      expect(fieldValue(batch, 'child', 'level')).toBe(2);
    });

    test('Bug B: child at end of section promotes to root', () => {
      const todos = [
        makeSection('sec-1', { position: 'f', parentId: null }),
        makeTodo('child-1', { position: 'f', parentId: 'sec-1' }),
        makeTodo('child-2', { position: 'n', parentId: 'sec-1' }),
        makeTodo('empty', { position: 'v', parentId: 'sec-1', text: '' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'empty')!;

      // Promoted to root
      expect(fieldValue(batch, 'empty', 'parentId')).toBeNull();
      // Does NOT touch preceding siblings
      expect(eventsFor(batch, 'child-1')).toHaveLength(0);
      expect(eventsFor(batch, 'child-2')).toHaveLength(0);
    });
  });

  describe('split behavior', () => {
    test('mid-section conversion under L1: stays under L1 (split)', () => {
      const todos = [
        makeSection('parent', { position: 'a', parentId: null, level: 1 }),
        makeTodo('child-1', { position: 'a', parentId: 'parent' }),
        makeTodo('child-2', { position: 'b', parentId: 'parent' }),
        makeTodo('child-3', { position: 'c', parentId: 'parent' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child-2')!;

      // child-2 stays under L1 parent (no promotion — split keeps it as L2 subsection)
      expect(eventsFor(batch, 'child-2').find(e => e.field === 'parentId')).toBeUndefined();
      // Only base events
      expect(batch).toHaveLength(3);
    });

    test('blank first child of L1 with following siblings: stays under L1', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 1 }),
        makeTodo('blank', { position: 'a', parentId: 'sec-a', text: '' }),
        makeTodo('task-1', { position: 'b', parentId: 'sec-a' }),
        makeTodo('task-2', { position: 'c', parentId: 'sec-a' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'blank')!;

      // blank stays under L1 sec-a (no promotion)
      expect(eventsFor(batch, 'blank').find(e => e.field === 'parentId')).toBeUndefined();
      // Only base events
      expect(batch).toHaveLength(3);
    });

    test('mid-section conversion under L2: promotes and adopts following siblings', () => {
      const todos = [
        makeSection('l1', { position: 'a', parentId: null, level: 1 }),
        makeSection('l2-a', { position: 'a', parentId: 'l1', level: 2 }),
        makeTodo('child-1', { position: 'a', parentId: 'l2-a' }),
        makeTodo('child-2', { position: 'b', parentId: 'l2-a' }),
        makeSection('l2-b', { position: 'z', parentId: 'l1', level: 2 }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child-1')!;

      // child-1 promoted to L1 level (grandparent of l2-a)
      expect(fieldValue(batch, 'child-1', 'parentId')).toBe('l1');
      const newPos = fieldValue(batch, 'child-1', 'position') as string;
      expect(newPos > 'a').toBe(true);
      expect(newPos < 'z').toBe(true);
      // child-2 adopted by child-1
      expect(fieldValue(batch, 'child-2', 'parentId')).toBe('child-1');
    });

    test('mid-section conversion under root L2: promotes to root and adopts', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 2 }),
        makeTodo('child-1', { position: 'a', parentId: 'sec-a' }),
        makeTodo('child-2', { position: 'b', parentId: 'sec-a' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child-1')!;

      // child-1 promoted to root
      expect(fieldValue(batch, 'child-1', 'parentId')).toBeNull();
      expect(fieldValue(batch, 'child-1', 'level')).toBe(1);
      // child-2 adopted by child-1
      expect(fieldValue(batch, 'child-2', 'parentId')).toBe('child-1');
    });

    test('blank last child of section: promotes out', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 1 }),
        makeTodo('task-1', { position: 'a', parentId: 'sec-a' }),
        makeTodo('blank', { position: 'z', parentId: 'sec-a', text: '' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'blank')!;

      // blank promoted to root as L1
      expect(fieldValue(batch, 'blank', 'parentId')).toBeNull();
      expect(fieldValue(batch, 'blank', 'level')).toBe(1);
      // task-1 not affected
      expect(eventsFor(batch, 'task-1')).toHaveLength(0);
      // 3 base (type, level=1, text) + 2 promotion (parentId, position) = 5 events
      expect(batch).toHaveLength(5);
    });

    test('L1 split: stays under L1 with no position change', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 1 }),
        makeTodo('child-1', { position: 'a', parentId: 'sec-a' }),
        makeTodo('child-2', { position: 'b', parentId: 'sec-a' }),
        makeSection('sec-b', { position: 'z', parentId: null, level: 1 }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child-1')!;

      // child-1 stays under sec-a (no promotion, no position change)
      expect(eventsFor(batch, 'child-1').find(e => e.field === 'parentId')).toBeUndefined();
      expect(eventsFor(batch, 'child-1').find(e => e.field === 'position')).toBeUndefined();
    });

    test('blank last child between two sections: promotes between them', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 1 }),
        makeTodo('task-1', { position: 'a', parentId: 'sec-a' }),
        makeTodo('blank', { position: 'b', parentId: 'sec-a', text: '' }),
        makeSection('sec-b', { position: 'z', parentId: null, level: 1 }),
        makeTodo('task-2', { position: 'a', parentId: 'sec-b' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'blank')!;

      // blank is last child of sec-a → promoted to root
      expect(fieldValue(batch, 'blank', 'parentId')).toBeNull();
      // Positioned between sec-a and sec-b
      const newPos = fieldValue(batch, 'blank', 'position') as string;
      expect(newPos > 'a').toBe(true);
      expect(newPos < 'z').toBe(true);
      // No children stolen from either section
      expect(eventsFor(batch, 'task-1')).toHaveLength(0);
      expect(eventsFor(batch, 'task-2')).toHaveLength(0);
    });

    test('blank sole child of section: promotes to root', () => {
      const todos = [
        makeSection('sec-a', { position: 'a', parentId: null, level: 1 }),
        makeTodo('blank', { position: 'a', parentId: 'sec-a', text: '' }),
        makeTodo('root-item', { position: 'z', parentId: null }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'blank')!;

      // blank promoted to root
      expect(fieldValue(batch, 'blank', 'parentId')).toBeNull();
      // root-item is NOT touched
      expect(eventsFor(batch, 'root-item')).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    test('handles single item list', () => {
      const todos = [makeTodo('only')];
      const batch = buildConvertToSectionEvents(todos, 'only')!;

      expect(batch).toHaveLength(3);
    });

    test('all events are field_changed type', () => {
      const todos = [
        makeTodo('a', { position: 'a' }),
        makeTodo('b', { position: 'b' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'a')!;

      for (const event of batch) {
        expect(event.type).toBe('field_changed');
      }
    });

    test('promotion when parent has orphaned parentId', () => {
      const todos = [
        makeSection('parent', { position: 'a', parentId: 'deleted-grandparent' }),
        makeTodo('child', { position: 'a', parentId: 'parent' }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'child')!;

      // Uses raw grandparentId from parent
      expect(fieldValue(batch, 'child', 'parentId')).toBe('deleted-grandparent');
    });

    test('converting item that is already a section still works', () => {
      const todos = [
        makeSection('existing', { position: 'a', parentId: null }),
        makeTodo('b', { position: 'b', parentId: null }),
      ];
      const batch = buildConvertToSectionEvents(todos, 'existing')!;

      expect(fieldValue(batch, 'existing', 'type')).toBe('section');
      // No adoption events — handled by rebuildParentIds
      expect(eventsFor(batch, 'b')).toHaveLength(0);
    });
  });
});
