import { describe, test, expect } from 'vitest';
import { projectState } from '../../lib/project-state';

function makeEvent(
  type: 'item_created' | 'field_changed' | 'item_deleted',
  itemId: string,
  field: string | null,
  value: any,
  timestamp: number,
) {
  return { itemId, type, field, value, timestamp };
}

describe('projectState', () => {
  test('returns empty array for no events', () => {
    expect(projectState([])).toEqual([]);
  });

  test('creates item from item_created event', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Hello', position: 'n' }, 1000),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('a');
    expect(items[0].text).toBe('Hello');
    expect(items[0].position).toBe('n');
    expect(items[0].completed).toBe(false);
    expect(items[0].important).toBe(false);
    expect(items[0].archived).toBe(false);
  });

  test('item_created with full state (compacted snapshot)', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, {
        text: 'Compacted',
        position: 'g',
        completed: true,
        completedAt: 2000,
        archived: true,
        archivedAt: 3000,
        important: true,
        type: 'section',
        level: 1,
        indented: true,
      }, 1000),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Compacted');
    expect(items[0].completed).toBe(true);
    expect(items[0].completedAt).toBe(2000);
    expect(items[0].archived).toBe(true);
    expect(items[0].archivedAt).toBe(3000);
    expect(items[0].important).toBe(true);
    expect(items[0].type).toBe('section');
    expect(items[0].level).toBe(1);
    expect(items[0].indented).toBe(true);
  });

  test('field_changed updates text', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Original', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'text', 'Updated', 2000),
    ]);
    expect(items[0].text).toBe('Updated');
    expect(items[0].textUpdatedAt).toBe(2000);
  });

  test('field_changed updates all supported fields', () => {
    const base = makeEvent('item_created', 'a', null, { text: 'Test', position: 'n' }, 1000);
    const items = projectState([
      base,
      makeEvent('field_changed', 'a', 'text', 'New text', 2000),
      makeEvent('field_changed', 'a', 'important', true, 2001),
      makeEvent('field_changed', 'a', 'completed', true, 2002),
      makeEvent('field_changed', 'a', 'position', 'z', 2003),
      makeEvent('field_changed', 'a', 'type', 'section', 2004),
      makeEvent('field_changed', 'a', 'level', 2, 2005),
      makeEvent('field_changed', 'a', 'indented', true, 2006),
      makeEvent('field_changed', 'a', 'archived', true, 2007),
    ]);
    expect(items[0].text).toBe('New text');
    expect(items[0].important).toBe(true);
    expect(items[0].completed).toBe(true);
    expect(items[0].completedAt).toBe(2002);
    expect(items[0].position).toBe('z');
    expect(items[0].type).toBe('section');
    expect(items[0].level).toBe(2);
    expect(items[0].indented).toBe(true);
    expect(items[0].archived).toBe(true);
    expect(items[0].archivedAt).toBe(2007);
  });

  test('LWW resolution: later timestamp wins', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Initial', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'text', 'Later wins', 2000),
      makeEvent('field_changed', 'a', 'text', 'Earlier loses', 1500),
    ]);
    expect(items[0].text).toBe('Later wins');
  });

  test('LWW: equal timestamps use last-processed', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Initial', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'text', 'First', 2000),
      makeEvent('field_changed', 'a', 'text', 'Second', 2000),
    ]);
    // Equal timestamps: second event is not < first, so it applies
    expect(items[0].text).toBe('Second');
  });

  test('item_deleted removes item', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Keep', position: 'a' }, 1000),
      makeEvent('item_created', 'b', null, { text: 'Delete', position: 'z' }, 1001),
      makeEvent('item_deleted', 'b', null, null, 2000),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Keep');
  });

  test('field_changed for nonexistent item is ignored', () => {
    const items = projectState([
      makeEvent('field_changed', 'nonexistent', 'text', 'Orphan', 1000),
    ]);
    expect(items).toEqual([]);
  });

  test('items sorted by position', () => {
    const items = projectState([
      makeEvent('item_created', 'z-id', null, { text: 'First', position: 'a' }, 1000),
      makeEvent('item_created', 'a-id', null, { text: 'Last', position: 'z' }, 1001),
    ]);
    expect(items[0].text).toBe('First');
    expect(items[1].text).toBe('Last');
  });

  test('identical positions sorted by ID', () => {
    const items = projectState([
      makeEvent('item_created', 'aaaaaaaa-0000-0000-0000-000000000001', null, { text: 'A', position: 'n' }, 1000),
      makeEvent('item_created', 'aaaaaaaa-0000-0000-0000-000000000003', null, { text: 'B', position: 'n' }, 1001),
      makeEvent('item_created', 'aaaaaaaa-0000-0000-0000-000000000002', null, { text: 'C', position: 'n' }, 1002),
    ]);
    expect(items[0].text).toBe('A'); // id ...0001
    expect(items[1].text).toBe('C'); // id ...0002
    expect(items[2].text).toBe('B'); // id ...0003
  });

  test('same order regardless of event insertion order', () => {
    const makeEvents = (order: string[]) =>
      order.map((suffix, i) =>
        makeEvent(
          'item_created',
          `aaaaaaaa-0000-0000-0000-00000000000${suffix}`,
          null,
          { text: `Item ${suffix}`, position: 'n' },
          1000 + i,
        )
      );

    const result1 = projectState(makeEvents(['3', '1', '2']));
    const result2 = projectState(makeEvents(['2', '1', '3']));

    const ids1 = result1.map((i: any) => i.id);
    const ids2 = result2.map((i: any) => i.id);
    expect(ids1).toEqual(ids2);
    expect(ids1).toEqual([
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000003',
    ]);
  });

  test('completing sets completedAt, uncompleting removes it', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Test', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'completed', true, 2000),
    ]);
    expect(items[0].completed).toBe(true);
    expect(items[0].completedAt).toBe(2000);

    const items2 = projectState([
      makeEvent('item_created', 'a', null, { text: 'Test', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'completed', true, 2000),
      makeEvent('field_changed', 'a', 'completed', false, 3000),
    ]);
    expect(items2[0].completed).toBe(false);
    expect(items2[0].completedAt).toBeUndefined();
  });

  test('archiving sets archivedAt, unarchiving clears it', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, { text: 'Test', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'archived', true, 2000),
    ]);
    expect(items[0].archived).toBe(true);
    expect(items[0].archivedAt).toBe(2000);

    const items2 = projectState([
      makeEvent('item_created', 'a', null, { text: 'Test', position: 'n' }, 1000),
      makeEvent('field_changed', 'a', 'archived', true, 2000),
      makeEvent('field_changed', 'a', 'archived', false, 3000),
    ]);
    expect(items2[0].archived).toBe(false);
    expect(items2[0].archivedAt).toBeNull();
  });

  test('defaults for item_created with empty value', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, {}, 1000),
    ]);
    expect(items[0].text).toBe('');
    expect(items[0].position).toBe('n');
    expect(items[0].type).toBe('todo');
    expect(items[0].completed).toBe(false);
    expect(items[0].important).toBe(false);
    expect(items[0].archived).toBe(false);
    expect(items[0].indented).toBe(false);
    expect(items[0].level).toBeNull();
    expect(items[0].createdAt).toBe(1000);
  });

  test('defaults for item_created with null value', () => {
    const items = projectState([
      makeEvent('item_created', 'a', null, null, 1000),
    ]);
    expect(items[0].text).toBe('');
    expect(items[0].position).toBe('n');
  });
});
