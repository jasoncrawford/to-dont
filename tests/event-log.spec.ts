import { test, expect, Page } from '@playwright/test';
import { setupPage, addTodo, getStoredTodos, completeTodo, deleteTodo, toggleImportant, CMD } from './helpers';

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

    const textCreate = createEvents.find((e: any) => e.value.text === 'Test item');
    expect(textCreate).toBeDefined();
    expect(textCreate.itemId).toBeDefined();
    expect(textCreate.clientId).toBeDefined();
    expect(textCreate.timestamp).toBeGreaterThan(0);
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
    const stored = await getStoredTodos(page);
    const deleteEvents = events.filter((e: any) => e.type === 'item_deleted');
    expect(deleteEvents.length).toBeGreaterThanOrEqual(1);
    // The item 'To delete' should no longer be in state
    expect(stored.every((t: any) => t.text !== 'To delete')).toBe(true);
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

  // Pure projectState tests (projection, LWW, sorting) are in
  // tests/unit/project-state.test.ts (vitest)

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

test.describe('parentId Migration', () => {
  test('assigns parentId based on section grouping on first load', async ({ page }) => {
    await setupPage(page);
    const now = Date.now();

    // Seed events: top item, L1 section, item under section, another L1 section, item under it
    await page.evaluate((now) => {
      const events = [
        { id: crypto.randomUUID(), itemId: 'top-item', type: 'item_created', field: null,
          value: { text: 'Top item', position: 'c' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'section-a', type: 'item_created', field: null,
          value: { text: 'Section A', position: 'f', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'item-under-a', type: 'item_created', field: null,
          value: { text: 'Under A', position: 'h' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'section-b', type: 'item_created', field: null,
          value: { text: 'Section B', position: 'n', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'item-under-b', type: 'item_created', field: null,
          value: { text: 'Under B', position: 't' }, timestamp: now, clientId: 'test', seq: 0 },
      ];
      localStorage.setItem('decay-events', JSON.stringify(events));
      localStorage.removeItem('decay-todos');
    }, now);

    // Reload to trigger migration
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    const byId = Object.fromEntries(stored.map((t: any) => [t.id, t]));

    // Top item has no parent
    expect(byId['top-item'].parentId).toBeNull();
    // L1 sections have no parent
    expect(byId['section-a'].parentId).toBeNull();
    expect(byId['section-b'].parentId).toBeNull();
    // Items under sections get parentId set
    expect(byId['item-under-a'].parentId).toBe('section-a');
    expect(byId['item-under-b'].parentId).toBe('section-b');
  });

  test('assigns parentId for L2 sections under L1 sections', async ({ page }) => {
    await setupPage(page);
    const now = Date.now();

    await page.evaluate((now) => {
      const events = [
        { id: crypto.randomUUID(), itemId: 'l1-section', type: 'item_created', field: null,
          value: { text: 'L1 Section', position: 'f', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'l2-section', type: 'item_created', field: null,
          value: { text: 'L2 Section', position: 'h', type: 'section', level: 2 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'item-under-l2', type: 'item_created', field: null,
          value: { text: 'Under L2', position: 'n' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'item-after-l2', type: 'item_created', field: null,
          value: { text: 'After L2 but under L1', position: 't' }, timestamp: now, clientId: 'test', seq: 0 },
      ];
      localStorage.setItem('decay-events', JSON.stringify(events));
      localStorage.removeItem('decay-todos');
    }, now);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    const byId = Object.fromEntries(stored.map((t: any) => [t.id, t]));

    expect(byId['l1-section'].parentId).toBeNull();
    expect(byId['l2-section'].parentId).toBe('l1-section');
    expect(byId['item-under-l2'].parentId).toBe('l2-section');
    // Item after L2 section but still under L1 — in the flat model, it's under L2
    // because L2 is the most recent section before this item
    expect(byId['item-after-l2'].parentId).toBe('l2-section');
  });

  test('migration is idempotent - does not run twice', async ({ page }) => {
    await setupPage(page);
    const now = Date.now();

    await page.evaluate((now) => {
      const events = [
        { id: crypto.randomUUID(), itemId: 'sec', type: 'item_created', field: null,
          value: { text: 'Section', position: 'f', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'item1', type: 'item_created', field: null,
          value: { text: 'Item 1', position: 'n' }, timestamp: now, clientId: 'test', seq: 0 },
      ];
      localStorage.setItem('decay-events', JSON.stringify(events));
      localStorage.removeItem('decay-todos');
    }, now);

    // First load triggers migration
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const eventsAfterFirst = await getEventLog(page);
    const migrationEvents1 = eventsAfterFirst.filter((e: any) => e.field === 'parentId');
    expect(migrationEvents1.length).toBe(1);

    // Second load should NOT add more migration events
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const eventsAfterSecond = await getEventLog(page);
    const migrationEvents2 = eventsAfterSecond.filter((e: any) => e.field === 'parentId');
    expect(migrationEvents2.length).toBe(1); // same count, not doubled
  });

  test('no migration when no sections exist', async ({ page }) => {
    await setupPage(page);
    const now = Date.now();

    await page.evaluate((now) => {
      const events = [
        { id: crypto.randomUUID(), itemId: 'item1', type: 'item_created', field: null,
          value: { text: 'Just an item', position: 'n' }, timestamp: now, clientId: 'test', seq: 0 },
      ];
      localStorage.setItem('decay-events', JSON.stringify(events));
      localStorage.removeItem('decay-todos');
    }, now);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const events = await getEventLog(page);
    const migrationEvents = events.filter((e: any) => e.field === 'parentId');
    expect(migrationEvents.length).toBe(0);
  });

  test('display order preserved after parentId migration', async ({ page }) => {
    await setupPage(page);
    const now = Date.now();

    await page.evaluate((now) => {
      const events = [
        { id: crypto.randomUUID(), itemId: 'top1', type: 'item_created', field: null,
          value: { text: 'Top 1', position: 'c' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'sec1', type: 'item_created', field: null,
          value: { text: 'Section 1', position: 'f', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'child1', type: 'item_created', field: null,
          value: { text: 'Child 1', position: 'h' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'child2', type: 'item_created', field: null,
          value: { text: 'Child 2', position: 'j' }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'sec2', type: 'item_created', field: null,
          value: { text: 'Section 2', position: 'n', type: 'section', level: 1 }, timestamp: now, clientId: 'test', seq: 0 },
        { id: crypto.randomUUID(), itemId: 'child3', type: 'item_created', field: null,
          value: { text: 'Child 3', position: 't' }, timestamp: now, clientId: 'test', seq: 0 },
      ];
      localStorage.setItem('decay-events', JSON.stringify(events));
      localStorage.removeItem('decay-todos');
    }, now);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const stored = await getStoredTodos(page);
    const displayOrder = stored.map((t: any) => t.text);
    // DFS traversal with global positions should match original flat order
    expect(displayOrder).toEqual([
      'Top 1', 'Section 1', 'Child 1', 'Child 2', 'Section 2', 'Child 3'
    ]);
  });
});
