import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

/**
 * Events API tests - verifies the event sourcing endpoints.
 * Uses the sync-e2e project (starts vercel dev on port 3001).
 *
 * Run with: npx playwright test --project=sync-e2e tests/events-api-sync-e2e.spec.ts
 */

const SYNC_TEST_PORT = 3001;
const API_URL = `http://localhost:${SYNC_TEST_PORT}`;
const BEARER_TOKEN = '8f512bd8190c0501c6ec356f821fdd32eff914a7770bd9e13b96b10923bfdb65';

function uuid() {
  return randomUUID();
}

async function apiPost(endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API POST ${endpoint} failed: ${response.status} - ${text}`);
  }
  return response.json();
}

async function apiGet(endpoint: string) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API GET ${endpoint} failed: ${response.status} - ${text}`);
  }
  return response.json();
}

async function clearEvents() {
  await fetch(`${API_URL}/api/events`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${BEARER_TOKEN}` },
  });
}

test.describe('Events API', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const testClientId = 'test-client-' + Date.now();

  test('POST /api/events stores events with seq assigned', async () => {
    const eventId = uuid();
    const itemId = uuid();

    const result = await apiPost('/api/events', {
      events: [{
        id: eventId,
        itemId: itemId,
        type: 'item_created',
        field: null,
        value: { text: 'Test item', position: 'n' },
        timestamp: Date.now(),
        clientId: testClientId,
      }],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe(eventId);
    expect(result.events[0].itemId).toBe(itemId);
    expect(result.events[0].type).toBe('item_created');
    expect(result.events[0].seq).toBeGreaterThan(0);
  });

  test('POST /api/events is idempotent (same UUID = no duplicate)', async () => {
    const eventId = uuid();
    const itemId = uuid();
    const event = {
      id: eventId,
      itemId: itemId,
      type: 'item_created' as const,
      field: null,
      value: { text: 'Idempotent test' },
      timestamp: Date.now(),
      clientId: testClientId,
    };

    // Insert once
    const result1 = await apiPost('/api/events', { events: [event] });
    expect(result1.events).toHaveLength(1);

    // Insert again with same ID
    const result2 = await apiPost('/api/events', { events: [event] });
    expect(result2.events).toHaveLength(1);
    // Should return the same event (not a duplicate) — same ID and type
    expect(result2.events[0].id).toBe(eventId);
    expect(result2.events[0].type).toBe('item_created');
  });

  test('POST /api/events handles multiple events in one request', async () => {
    const itemId = uuid();
    const events = [
      {
        id: uuid(),
        itemId: itemId,
        type: 'item_created' as const,
        field: null,
        value: { text: 'Batch item', position: 'n' },
        timestamp: Date.now(),
        clientId: testClientId,
      },
      {
        id: uuid(),
        itemId: itemId,
        type: 'field_changed' as const,
        field: 'text',
        value: 'Updated batch item',
        timestamp: Date.now() + 1,
        clientId: testClientId,
      },
    ];

    const result = await apiPost('/api/events', { events });
    expect(result.events).toHaveLength(2);
    // Seqs should be in order
    expect(result.events[1].seq).toBeGreaterThan(result.events[0].seq);
  });

  test('GET /api/events?since=0 returns events in order', async () => {
    // Insert an event to ensure there's at least one
    await apiPost('/api/events', {
      events: [{
        id: uuid(),
        itemId: uuid(),
        type: 'item_created',
        field: null,
        value: { text: 'Query test' },
        timestamp: Date.now(),
        clientId: testClientId,
      }],
    });

    const result = await apiGet('/api/events?since=0');
    expect(result.events).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    // Events should be ordered by seq
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].seq).toBeGreaterThan(result.events[i - 1].seq);
    }
  });

  test('GET /api/events?since=N returns only newer events', async () => {
    // Insert two events in a single batch. The first has a lower seq than
    // the second. We immediately query ?since=firstSeq and check the filter.
    // To handle concurrent clearDatabase() from sync-e2e tests, we insert
    // and query in a tight loop with retries.
    const baselineId = uuid();
    const newEventId = uuid();
    const baselineItemId = uuid();
    const newItemId = uuid();

    let verified = false;
    for (let attempt = 0; attempt < 5 && !verified; attempt++) {
      const result = await apiPost('/api/events', {
        events: [
          { id: baselineId, itemId: baselineItemId, type: 'item_created', field: null, value: { text: 'Baseline event' }, timestamp: Date.now(), clientId: testClientId },
          { id: newEventId, itemId: newItemId, type: 'item_created', field: null, value: { text: 'After cursor' }, timestamp: Date.now() + 1, clientId: testClientId },
        ],
      });

      const baselineEvent = result.events.find((e: any) => e.id === baselineId);
      const newEvent = result.events.find((e: any) => e.id === newEventId);
      if (!baselineEvent || !newEvent) continue;

      // Verify ordering from the POST response
      expect(newEvent.seq).toBeGreaterThan(baselineEvent.seq);

      // Immediately query with since=baselineSeq
      const queryResult = await apiGet(`/api/events?since=${baselineEvent.seq}`);
      if (queryResult.events.length === 0) continue; // Deleted between insert and query

      // The new event should be in the results
      const foundNew = queryResult.events.find((e: any) => e.id === newEventId);
      if (!foundNew) continue;

      // Should NOT contain the baseline event
      expect(queryResult.events.every((e: any) => e.seq > baselineEvent.seq)).toBe(true);
      verified = true;
    }
    expect(verified).toBe(true);
  });

  test('GET /api/events respects limit parameter', async () => {
    const result = await apiGet('/api/events?since=0&limit=2');
    expect(result.events.length).toBeLessThanOrEqual(2);
  });

  test('POST /api/events rejects empty events array', async () => {
    const response = await fetch(`${API_URL}/api/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: [] }),
    });
    expect(response.status).toBe(400);
  });

  test('POST /api/events rejects unauthorized requests', async () => {
    const response = await fetch(`${API_URL}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: [{ id: uuid(), itemId: uuid(), type: 'item_created', field: null, value: {}, timestamp: Date.now(), clientId: 'x' }] }),
    });
    expect(response.status).toBe(401);
  });

  test('old API endpoints still work', async () => {
    // GET /api/items should still work
    const items = await apiGet('/api/items');
    expect(Array.isArray(items)).toBe(true);
  });
});
