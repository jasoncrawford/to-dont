import { describe, test, expect } from 'vitest';
import { buildConvertToSectionEvents } from '../../src/utils';
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

function fieldValue(batch: ReturnType<typeof buildConvertToSectionEvents>, itemId: string, field: string) {
  if (!batch) return undefined;
  const event = batch.find(e => e.itemId === itemId && e.field === field);
  return event?.value;
}

describe('buildConvertToSectionEvents', () => {
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

  test('produces exactly 3 events', () => {
    const todos = [makeTodo('a')];
    const batch = buildConvertToSectionEvents(todos, 'a')!;

    expect(batch).toHaveLength(3);
  });

  test('all events are field_changed type', () => {
    const todos = [makeTodo('a')];
    const batch = buildConvertToSectionEvents(todos, 'a')!;

    for (const event of batch) {
      expect(event.type).toBe('field_changed');
    }
  });

  test('does not emit events for other items', () => {
    const todos = [
      makeTodo('a', { position: 'a' }),
      makeTodo('b', { position: 'b' }),
      makeTodo('c', { position: 'c' }),
    ];
    const batch = buildConvertToSectionEvents(todos, 'b')!;

    expect(batch.filter(e => e.itemId !== 'b')).toHaveLength(0);
  });
});
