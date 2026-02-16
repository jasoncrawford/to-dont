import { test, expect, Page } from '@playwright/test';
import { setupPage, addTodo, getTodoTexts, getStoredTodos, completeTodo, deleteTodo, toggleImportant, CMD } from './helpers';

/**
 * Event Log tests - verifies that mutations create events and
 * state projection derives correct state from events.
 *
 * Run with: npx playwright test --project=chromium tests/event-log.spec.ts
 */

async function getEventLog(page: Page) {
  return page.evaluate(() => {
    const data = localStorage.getItem('decay-events');
    return data ? JSON.parse(data) : [];
  });
}

async function getEventTypes(page: Page) {
  const events = await getEventLog(page);
  return events.map((e: any) => e.type);
}

test.describe('Event Log', () => {
  test('adding a todo creates an item_created event', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Test item');

    const events = await getEventLog(page);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const createEvents = events.filter((e: any) => e.type === 'item_created');
    expect(createEvents.length).toBeGreaterThanOrEqual(1);

    const lastCreate = createEvents[createEvents.length - 1];
    expect(lastCreate.value.text).toBe('Test item');
    expect(lastCreate.itemId).toBeDefined();
    expect(lastCreate.clientId).toBeDefined();
    expect(lastCreate.timestamp).toBeGreaterThan(0);
  });

  test('item IDs are UUIDs', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'UUID test');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    // UUID format: 8-4-4-4-12 hex digits
    expect(stored[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('editing text creates a field_changed(text) event', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Original');

    // Edit the text
    const textEl = page.locator('.todo-item .text').first();
    await textEl.click();
    await textEl.press(`${CMD}+a`);
    await textEl.pressSequentially('Updated');
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);

    const events = await getEventLog(page);
    const textChanges = events.filter((e: any) => e.type === 'field_changed' && e.field === 'text');
    expect(textChanges.length).toBeGreaterThanOrEqual(1);
    // The last text change should have the updated value
    const lastChange = textChanges[textChanges.length - 1];
    expect(lastChange.value).toBe('Updated');
  });

  test('deleting creates an item_deleted event', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'To delete');
    await deleteTodo(page, 'To delete');

    const events = await getEventLog(page);
    const deleteEvents = events.filter((e: any) => e.type === 'item_deleted');
    expect(deleteEvents).toHaveLength(1);
  });

  test('completing creates a field_changed(completed) event', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'To complete');
    await completeTodo(page, 'To complete');

    const events = await getEventLog(page);
    const completedEvents = events.filter(
      (e: any) => e.type === 'field_changed' && e.field === 'completed'
    );
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    expect(completedEvents[completedEvents.length - 1].value).toBe(true);
  });

  test('toggling important creates a field_changed(important) event', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Important item');
    await toggleImportant(page, 'Important item');

    const events = await getEventLog(page);
    const importantEvents = events.filter(
      (e: any) => e.type === 'field_changed' && e.field === 'important'
    );
    expect(importantEvents.length).toBeGreaterThanOrEqual(1);
    expect(importantEvents[importantEvents.length - 1].value).toBe(true);
  });

  test('projection derives correct state from events', async ({ page }) => {
    await setupPage(page);

    // Create events directly and verify projection
    await page.evaluate(() => {
      const itemId = crypto.randomUUID();
      localStorage.setItem('decay-events', JSON.stringify([
        {
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'item_created',
          field: null,
          value: { text: 'Hello', position: 'n' },
          timestamp: Date.now(),
          clientId: 'test',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'field_changed',
          field: 'text',
          value: 'Hello World',
          timestamp: Date.now() + 1,
          clientId: 'test',
          seq: null,
        },
      ]));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Hello World');
  });

  test('LWW resolution: later timestamp wins', async ({ page }) => {
    await setupPage(page);

    const now = Date.now();
    await page.evaluate((now) => {
      const itemId = crypto.randomUUID();
      localStorage.setItem('decay-events', JSON.stringify([
        {
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'item_created',
          field: null,
          value: { text: 'Initial', position: 'n' },
          timestamp: now,
          clientId: 'test',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'field_changed',
          field: 'text',
          value: 'Later wins',
          timestamp: now + 100,
          clientId: 'client-b',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: itemId,
          type: 'field_changed',
          field: 'text',
          value: 'Earlier loses',
          timestamp: now + 50,
          clientId: 'client-a',
          seq: null,
        },
      ]));
    }, now);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Later wins');
  });

  test('materialized state matches projected state', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'First');
    await addTodo(page, 'Second');
    await completeTodo(page, 'First');

    const stored = await getStoredTodos(page);
    const projected = await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('decay-events') || '[]');
      return (window as any).EventLog.projectState(events);
    });

    expect(stored.length).toBe(projected.length);
    for (let i = 0; i < stored.length; i++) {
      expect(stored[i].id).toBe(projected[i].id);
      expect(stored[i].text).toBe(projected[i].text);
      expect(stored[i].completed).toBe(projected[i].completed);
    }
  });

  test('migration from existing decay-todos works', async ({ page }) => {
    await setupPage(page);

    // Set up existing todos without events
    await page.evaluate(() => {
      localStorage.setItem('decay-todos', JSON.stringify([
        {
          id: 'old-id-1',
          text: 'Existing item',
          createdAt: Date.now(),
          important: true,
          completed: false,
          archived: false,
          position: 'n',
          textUpdatedAt: Date.now(),
          importantUpdatedAt: Date.now(),
          completedUpdatedAt: Date.now(),
          positionUpdatedAt: Date.now(),
        },
      ]));
      // Ensure no events exist
      localStorage.removeItem('decay-events');
    });

    // Reload to trigger migration
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Should have events now
    const events = await getEventLog(page);
    expect(events.length).toBeGreaterThan(0);

    // Item should still be accessible
    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Existing item');
    expect(stored[0].important).toBe(true);
  });

  test('event log persists client ID', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Test');

    const clientId = await page.evaluate(() => (window as any).EventLog.getClientId());
    expect(clientId).toBeDefined();
    expect(clientId.length).toBeGreaterThan(0);

    // Reload and check it's the same
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const clientId2 = await page.evaluate(() => (window as any).EventLog.getClientId());
    expect(clientId2).toBe(clientId);
  });

  test('items with identical positions are sorted deterministically by ID', async ({ page }) => {
    await setupPage(page);

    const now = Date.now();
    await page.evaluate((now) => {
      localStorage.setItem('decay-events', JSON.stringify([
        {
          id: crypto.randomUUID(),
          itemId: 'aaaaaaaa-0000-0000-0000-000000000001',
          type: 'item_created',
          field: null,
          value: { text: 'Item A', position: 'n' },
          timestamp: now,
          clientId: 'test',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: 'aaaaaaaa-0000-0000-0000-000000000003',
          type: 'item_created',
          field: null,
          value: { text: 'Item B', position: 'n' },
          timestamp: now + 1,
          clientId: 'test',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: 'aaaaaaaa-0000-0000-0000-000000000002',
          type: 'item_created',
          field: null,
          value: { text: 'Item C', position: 'n' },
          timestamp: now + 2,
          clientId: 'test',
          seq: null,
        },
      ]));
    }, now);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(3);
    // All have position 'n', so they should sort by ID: 0001 < 0002 < 0003
    expect(stored[0].text).toBe('Item A'); // id ends ...0001
    expect(stored[1].text).toBe('Item C'); // id ends ...0002
    expect(stored[2].text).toBe('Item B'); // id ends ...0003
  });

  test('position tiebreaker does not affect items with different positions', async ({ page }) => {
    await setupPage(page);

    const now = Date.now();
    await page.evaluate((now) => {
      localStorage.setItem('decay-events', JSON.stringify([
        {
          id: crypto.randomUUID(),
          itemId: 'zzzzzzzz-0000-0000-0000-000000000001',
          type: 'item_created',
          field: null,
          value: { text: 'Item X', position: 'a' },
          timestamp: now,
          clientId: 'test',
          seq: null,
        },
        {
          id: crypto.randomUUID(),
          itemId: 'aaaaaaaa-0000-0000-0000-000000000001',
          type: 'item_created',
          field: null,
          value: { text: 'Item Y', position: 'z' },
          timestamp: now + 1,
          clientId: 'test',
          seq: null,
        },
      ]));
    }, now);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(2);
    // Position 'a' < 'z', so X comes first despite having a later ID
    expect(stored[0].text).toBe('Item X');
    expect(stored[1].text).toBe('Item Y');
  });

  test('projectState produces same order regardless of event insertion order', async ({ page }) => {
    await setupPage(page);

    const now = Date.now();
    const result = await page.evaluate((now) => {
      const makeEvents = (order: string[]) => order.map((suffix, i) => ({
        id: crypto.randomUUID(),
        itemId: `aaaaaaaa-0000-0000-0000-00000000000${suffix}`,
        type: 'item_created',
        field: null,
        value: { text: `Item ${suffix}`, position: 'n' },
        timestamp: now + i,
        clientId: 'test',
        seq: null,
      }));

      const eventsOriginal = makeEvents(['3', '1', '2']);
      const eventsReversed = makeEvents(['2', '1', '3']);

      const projectedOriginal = (window as any).EventLog.projectState(eventsOriginal);
      const projectedReversed = (window as any).EventLog.projectState(eventsReversed);

      return {
        originalOrder: projectedOriginal.map((i: any) => i.id),
        reversedOrder: projectedReversed.map((i: any) => i.id),
      };
    }, now);

    // Both orderings should produce the same item order
    expect(result.originalOrder).toEqual(result.reversedOrder);
    // And that order should be sorted by ID
    expect(result.originalOrder).toEqual([
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000003',
    ]);
  });

  test('compactEvents reduces event count while preserving state', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'First item');
    await addTodo(page, 'Second item');
    await toggleImportant(page, 'First item');

    // Verify we have multiple events before compaction
    let events = await getEventLog(page);
    const preCompactCount = events.length;
    expect(preCompactCount).toBeGreaterThan(2);

    // Get state before compaction
    const stateBefore = await getStoredTodos(page);

    // Mark all events as synced (compaction only replaces synced events)
    await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('decay-events') || '[]');
      for (const e of events) e.seq = 1;
      localStorage.setItem('decay-events', JSON.stringify(events));
    });

    // Compact
    await page.evaluate(() => (window as any).EventLog.compactEvents());

    // After compaction: should have exactly 2 synthetic item_created events (no unsynced)
    events = await getEventLog(page);
    expect(events.length).toBe(2);
    expect(events.every((e: any) => e.type === 'item_created')).toBe(true);

    // State should be preserved
    const stateAfter = await getStoredTodos(page);
    expect(stateAfter.length).toBe(stateBefore.length);
    for (let i = 0; i < stateBefore.length; i++) {
      expect(stateAfter[i].id).toBe(stateBefore[i].id);
      expect(stateAfter[i].text).toBe(stateBefore[i].text);
      expect(stateAfter[i].important).toBe(stateBefore[i].important);
      expect(stateAfter[i].completed).toBe(stateBefore[i].completed);
      expect(stateAfter[i].position).toBe(stateBefore[i].position);
    }
  });

  test('compactEvents preserves unsynced events', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Synced item');

    // Mark existing events as synced
    await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('decay-events') || '[]');
      for (const e of events) e.seq = 1;
      localStorage.setItem('decay-events', JSON.stringify(events));
    });

    // Add another item (unsynced, seq=null)
    await addTodo(page, 'Unsynced item');

    const eventsBefore = await getEventLog(page);
    const unsyncedBefore = eventsBefore.filter((e: any) => e.seq === null);
    expect(unsyncedBefore.length).toBeGreaterThan(0);

    // Compact
    await page.evaluate(() => (window as any).EventLog.compactEvents());

    const eventsAfter = await getEventLog(page);
    // Should have 2 snapshots + unsynced events
    const snapshots = eventsAfter.filter((e: any) => e.type === 'item_created' && e.seq === 0);
    const unsynced = eventsAfter.filter((e: any) => e.seq === null);
    expect(snapshots.length).toBe(2); // both items as snapshots
    expect(unsynced.length).toBe(unsyncedBefore.length);

    // State should still have both items
    const stored = await getStoredTodos(page);
    const texts = stored.map((t: any) => t.text);
    expect(texts).toContain('Synced item');
    expect(texts).toContain('Unsynced item');
  });

  test('compactEvents preserves completed/archived state in snapshots', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Complete me');
    await completeTodo(page, 'Complete me');

    // Mark all as synced
    await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('decay-events') || '[]');
      for (const e of events) e.seq = 1;
      localStorage.setItem('decay-events', JSON.stringify(events));
    });

    // Compact
    await page.evaluate(() => (window as any).EventLog.compactEvents());

    // Reload to verify the compacted events reconstruct state correctly
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Complete me');
    expect(stored[0].completed).toBe(true);
    expect(stored[0].completedAt).toBeDefined();
  });

  test('compactEvents on empty log is a no-op', async ({ page }) => {
    await setupPage(page);

    // Ensure empty event log
    await page.evaluate(() => localStorage.removeItem('decay-events'));

    // Should not throw
    await page.evaluate(() => (window as any).EventLog.compactEvents());

    const events = await getEventLog(page);
    expect(events).toHaveLength(0);
  });

  test('item_deleted removes item from projected state', async ({ page }) => {
    await setupPage(page);
    await addTodo(page, 'Will delete');
    await addTodo(page, 'Will keep');

    let stored = await getStoredTodos(page);
    expect(stored).toHaveLength(2);

    await deleteTodo(page, 'Will delete');

    stored = await getStoredTodos(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Will keep');
  });
});
